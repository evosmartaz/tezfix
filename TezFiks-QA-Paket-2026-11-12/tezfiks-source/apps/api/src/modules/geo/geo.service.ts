import { Inject, Injectable, Logger } from '@nestjs/common';
import { latLngToCell } from 'h3-js';
import {
  BAKU_CENTER,
  decodePolyline,
  encodePolyline,
  fallbackRoute,
  haversineMeters,
  type GeoAddress,
  type LatLng,
  type Locale,
} from '@tezfiks/shared';
import { ENV, type Env } from '../../config/env';
import { Clock } from '../../infra/clock';
import { ApiException } from '../../common/http/api-exception';
import { nearestBakuDistrict } from './baku-districts';

/** Injectable fetch used for every Google call (tests provide a mock). */
export const GEO_FETCH = Symbol('GEO_FETCH');
export type GeoFetch = (input: string, init?: RequestInit) => Promise<Response>;

export const GEO_HTTP_TIMEOUT_MS = 5_000;
export const AUTOCOMPLETE_BIAS_RADIUS_M = 30_000;

export const GOOGLE_GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
export const GOOGLE_AUTOCOMPLETE_URL = 'https://places.googleapis.com/v1/places:autocomplete';
export const GOOGLE_PLACE_URL = 'https://places.googleapis.com/v1/places/';
export const GOOGLE_ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
export const PLACE_FIELD_MASK = 'id,location,formattedAddress,addressComponents';
export const ROUTES_FIELD_MASK = 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline';
export const AUTOCOMPLETE_FIELD_MASK =
  'suggestions.placePrediction.placeId,suggestions.placePrediction.text.text,suggestions.placePrediction.structuredFormat';

export type GeoSource = 'google' | 'fallback';

export interface AutocompleteItem {
  placeId: string;
  primary: string;
  secondary: string | null;
}

export interface AutocompleteResult {
  items: AutocompleteItem[];
  source: GeoSource;
}

export interface RouteResult {
  /** Google encoded polyline (precision 5). */
  polyline: string;
  durationSec: number;
  distanceM: number;
  source: GeoSource;
  computedAt: Date;
}

export interface RouteProgress {
  /** Metres left along the route from the point snapped onto it. */
  remainingDistanceM: number;
  /** totalDurationSec scaled by remaining / total distance. */
  remainingSec: number;
  /** Distance from the current position to the closest point of the route. */
  offRouteM: number;
}

interface AddressParts {
  district: string | null;
  street: string | null;
  building: string | null;
}

/** Fallback address text for a pin: "40.37770, 49.85310". */
export function coordinatesText(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

/** "123s" / "123.5s" -> 124 */
function parseDurationSec(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const m = /^(\d+(?:\.\d+)?)s$/.exec(v.trim());
  return m ? Math.round(Number(m[1])) : null;
}

const DISTRICT_TYPES = ['sublocality_level_1', 'sublocality', 'administrative_area_level_2', 'political_district'];

function pickComponents(components: Array<{ name: string; types: string[] }>): AddressParts {
  const find = (types: string[]) => {
    for (const t of types) {
      const c = components.find((x) => x.types.includes(t));
      if (c && c.name) return c.name;
    }
    return null;
  };
  return { district: find(DISTRICT_TYPES), street: find(['route']), building: find(['street_number', 'premise']) };
}

/** Geocoding, Places autocomplete/details and Routes via Google with deterministic fallbacks; H3 helpers. */
@Injectable()
export class GeoService {
  private readonly log = new Logger('GeoService');

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(GEO_FETCH) private readonly fetchFn: GeoFetch,
    private readonly clock: Clock,
  ) {}

  get mapsEnabled(): boolean {
    return !!this.env.GOOGLE_MAPS_SERVER_KEY;
  }

  cell7(lat: number, lng: number): string {
    return latLngToCell(lat, lng, 7);
  }

  cell9(lat: number, lng: number): string {
    return latLngToCell(lat, lng, 9);
  }

  /** Reverse geocodes a pin in the caller language; coordinates + nearest Baku district when Google is unavailable. */
  async reverse(lat: number, lng: number, locale: Locale): Promise<GeoAddress> {
    const key = this.env.GOOGLE_MAPS_SERVER_KEY;
    if (key) {
      try {
        const url = `${GOOGLE_GEOCODE_URL}?latlng=${lat},${lng}&language=${locale}&key=${encodeURIComponent(key)}`;
        const body = await this.getJson(url, { method: 'GET' });
        const results = (body?.results ?? []) as Array<{
          formatted_address?: string;
          place_id?: string;
          address_components?: Array<{ long_name?: string; types?: string[] }>;
        }>;
        const first = results[0];
        if (body?.status === 'OK' && first?.formatted_address) {
          const parts = pickComponents(
            (first.address_components ?? []).map((c) => ({ name: c.long_name ?? '', types: c.types ?? [] })),
          );
          return {
            lat,
            lng,
            formatted: first.formatted_address,
            placeId: first.place_id ?? null,
            district: parts.district ?? this.fallbackDistrict(lat, lng, locale),
            street: parts.street,
            building: parts.building,
            source: 'google',
          };
        }
        if (body?.status !== 'ZERO_RESULTS') this.log.warn(`geocode status ${String(body?.status)}`);
      } catch (e) {
        this.log.warn(`geocode failed: ${(e as Error).message}`);
      }
    }
    return this.fallbackAddress(lat, lng, locale);
  }

  /** Places (New) autocomplete restricted to Azerbaijan, biased to a 30 km circle (default: Baku centre). */
  async autocomplete(q: string, sessionToken: string, bias: LatLng | null | undefined, locale: Locale): Promise<AutocompleteResult> {
    const key = this.env.GOOGLE_MAPS_SERVER_KEY;
    if (!key) return { items: [], source: 'fallback' };
    const center = bias ?? BAKU_CENTER;
    try {
      const body = await this.getJson(GOOGLE_AUTOCOMPLETE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': AUTOCOMPLETE_FIELD_MASK },
        body: JSON.stringify({
          input: q,
          sessionToken,
          languageCode: locale,
          includedRegionCodes: ['az'],
          locationBias: { circle: { center: { latitude: center.lat, longitude: center.lng }, radius: AUTOCOMPLETE_BIAS_RADIUS_M } },
        }),
      });
      const suggestions = (body?.suggestions ?? []) as Array<{
        placePrediction?: {
          placeId?: string;
          text?: { text?: string };
          structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } };
        };
      }>;
      const items: AutocompleteItem[] = [];
      for (const s of suggestions) {
        const p = s.placePrediction;
        if (!p?.placeId) continue;
        const primary = p.structuredFormat?.mainText?.text ?? p.text?.text;
        if (!primary) continue;
        items.push({ placeId: p.placeId, primary, secondary: p.structuredFormat?.secondaryText?.text ?? null });
      }
      return { items, source: 'google' };
    } catch (e) {
      this.log.warn(`autocomplete failed: ${(e as Error).message}`);
      return { items: [], source: 'fallback' };
    }
  }

  /** Place Details (New). Without maps (no key / provider error) the place cannot be resolved -> NOT_FOUND. */
  async place(placeId: string, sessionToken: string | null | undefined, locale: Locale): Promise<GeoAddress> {
    const key = this.env.GOOGLE_MAPS_SERVER_KEY;
    if (!key) throw new ApiException('NOT_FOUND', { entity: 'place', reason: 'maps_unavailable' });
    const qs = new URLSearchParams({ languageCode: locale });
    if (sessionToken) qs.set('sessionToken', sessionToken);
    let body: Record<string, unknown> | null;
    try {
      body = await this.getJson(`${GOOGLE_PLACE_URL}${encodeURIComponent(placeId)}?${qs.toString()}`, {
        method: 'GET',
        headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': PLACE_FIELD_MASK },
      });
    } catch (e) {
      this.log.warn(`place details failed: ${(e as Error).message}`);
      throw new ApiException('NOT_FOUND', { entity: 'place', reason: 'maps_unavailable' });
    }
    const loc = body?.location as { latitude?: number; longitude?: number } | undefined;
    if (!body || typeof loc?.latitude !== 'number' || typeof loc?.longitude !== 'number') {
      throw new ApiException('NOT_FOUND', { entity: 'place' });
    }
    const lat = loc.latitude;
    const lng = loc.longitude;
    const comps = ((body.addressComponents ?? []) as Array<{ longText?: string; types?: string[] }>).map((c) => ({
      name: c.longText ?? '',
      types: c.types ?? [],
    }));
    const parts = pickComponents(comps);
    return {
      lat,
      lng,
      formatted: typeof body.formattedAddress === 'string' && body.formattedAddress ? body.formattedAddress : coordinatesText(lat, lng),
      placeId: typeof body.id === 'string' ? body.id : placeId,
      district: parts.district ?? this.fallbackDistrict(lat, lng, locale),
      street: parts.street,
      building: parts.building,
      source: 'google',
    };
  }

  /** Driving route (Routes API computeRoutes); straight-line fallback (haversine x 1.35 at 25 km/h). */
  async route(origin: LatLng, destination: LatLng, opts: { trafficAware?: boolean } = {}): Promise<RouteResult> {
    const key = this.env.GOOGLE_MAPS_SERVER_KEY;
    if (key) {
      try {
        const body = await this.getJson(GOOGLE_ROUTES_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': ROUTES_FIELD_MASK },
          body: JSON.stringify({
            origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
            destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
            travelMode: 'DRIVE',
            routingPreference: opts.trafficAware ? 'TRAFFIC_AWARE' : 'TRAFFIC_UNAWARE',
            polylineEncoding: 'ENCODED_POLYLINE',
          }),
        });
        const r = (body?.routes as Array<{ duration?: string; distanceMeters?: number; polyline?: { encodedPolyline?: string } }> | undefined)?.[0];
        const durationSec = parseDurationSec(r?.duration);
        const polyline = r?.polyline?.encodedPolyline;
        if (r && durationSec !== null && polyline) {
          return {
            polyline,
            durationSec,
            distanceM: Math.round(r.distanceMeters ?? 0),
            source: 'google',
            computedAt: this.clock.now(),
          };
        }
        this.log.warn('computeRoutes returned no route');
      } catch (e) {
        this.log.warn(`computeRoutes failed: ${(e as Error).message}`);
      }
    }
    return this.fallbackRouteResult(origin, destination);
  }

  fallbackRouteResult(origin: LatLng, destination: LatLng): RouteResult {
    const { distanceM, durationSec } = fallbackRoute(origin, destination);
    return { polyline: encodePolyline([origin, destination]), durationSec, distanceM, source: 'fallback', computedAt: this.clock.now() };
  }

  /**
   * Snaps `current` onto the closest segment of `polyline` and returns the distance left along the route,
   * the remaining time (totalDurationSec scaled by remaining/total distance) and how far off the route the point is.
   */
  progressAlong(polyline: string, current: LatLng, totalDurationSec: number): RouteProgress {
    const path = decodePolyline(polyline);
    if (path.length === 0) return { remainingDistanceM: 0, remainingSec: 0, offRouteM: 0 };
    if (path.length === 1) {
      return { remainingDistanceM: 0, remainingSec: 0, offRouteM: Math.round(haversineMeters(current, path[0]!)) };
    }
    const segLens: number[] = [];
    let total = 0;
    for (let i = 1; i < path.length; i++) {
      const d = haversineMeters(path[i - 1]!, path[i]!);
      segLens.push(d);
      total += d;
    }
    // Local equirectangular projection around the current point (metres).
    const mPerDegLat = 111_195;
    const mPerDegLng = 111_195 * Math.cos((current.lat * Math.PI) / 180);
    const proj = (p: LatLng) => ({ x: (p.lng - current.lng) * mPerDegLng, y: (p.lat - current.lat) * mPerDegLat });
    let bestIdx = 0;
    let bestT = 0;
    let bestDist = Infinity;
    for (let i = 0; i < segLens.length; i++) {
      const a = proj(path[i]!);
      const b = proj(path[i + 1]!);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (-a.x * dx + -a.y * dy) / len2));
      const qx = a.x + t * dx;
      const qy = a.y + t * dy;
      const dist = Math.hypot(qx, qy);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
        bestT = t;
      }
    }
    let remaining = segLens[bestIdx]! * (1 - bestT);
    for (let i = bestIdx + 1; i < segLens.length; i++) remaining += segLens[i]!;
    const remainingSec = total > 0 ? Math.round((Math.max(0, totalDurationSec) * remaining) / total) : 0;
    return { remainingDistanceM: Math.round(remaining), remainingSec, offRouteM: Math.round(bestDist) };
  }

  private fallbackDistrict(lat: number, lng: number, locale: Locale): string | null {
    return nearestBakuDistrict({ lat, lng })?.names[locale] ?? null;
  }

  private fallbackAddress(lat: number, lng: number, locale: Locale): GeoAddress {
    return {
      lat,
      lng,
      formatted: coordinatesText(lat, lng),
      placeId: null,
      district: this.fallbackDistrict(lat, lng, locale),
      street: null,
      building: null,
      source: 'fallback',
    };
  }

  /** fetch with a 5 s timeout; non-2xx or invalid JSON throws. */
  private async getJson(url: string, init: RequestInit): Promise<Record<string, unknown> | null> {
    const res = await this.fetchFn(url, { ...init, signal: AbortSignal.timeout(GEO_HTTP_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as unknown;
    return json && typeof json === 'object' ? (json as Record<string, unknown>) : null;
  }
}
