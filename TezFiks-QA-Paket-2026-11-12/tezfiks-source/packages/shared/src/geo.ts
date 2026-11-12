import type { Locale } from './enums';

export interface LatLng {
  lat: number;
  lng: number;
}

/** Baku city centre (Fountain Square). */
export const BAKU_CENTER: LatLng = { lat: 40.3777, lng: 49.8531 };

/** Great-circle distance in metres. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6_371_008.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Road-distance and ETA estimate used when no routing provider is configured: 1.35 x straight line at 25 km/h. */
export function fallbackRoute(a: LatLng, b: LatLng): { distanceM: number; durationSec: number } {
  const distanceM = Math.round(haversineMeters(a, b) * 1.35);
  const durationSec = Math.round(distanceM / (25_000 / 3600));
  return { distanceM, durationSec };
}

/** "850 m", "2.4 km" (en) / "2,4 km" (az, ru). */
export function formatDistance(meters: number, locale: Locale): string {
  if (meters < 1000) return `${Math.max(0, Math.round(meters / 10) * 10)} m`;
  const km = (meters / 1000).toFixed(meters < 10_000 ? 1 : 0);
  return `${locale === 'en' ? km : km.replace('.', ',')} km`;
}

/** Linear interpolation along a polyline, used by the demo simulator and map animations. */
export function pointAlong(path: LatLng[], fraction: number): LatLng {
  if (path.length === 0) throw new Error('empty path');
  if (path.length === 1 || fraction <= 0) return path[0]!;
  if (fraction >= 1) return path[path.length - 1]!;
  const segs: number[] = [];
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const d = haversineMeters(path[i - 1]!, path[i]!);
    segs.push(d);
    total += d;
  }
  let target = total * fraction;
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]!;
    if (target <= seg) {
      const t = seg === 0 ? 0 : target / seg;
      const a = path[i]!;
      const b = path[i + 1]!;
      return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
    }
    target -= seg;
  }
  return path[path.length - 1]!;
}

/** Total length of a polyline in metres. */
export function pathLengthMeters(path: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += haversineMeters(path[i - 1]!, path[i]!);
  return total;
}

/** Decodes a Google encoded polyline (precision 5). */
export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    result = 0;
    shift = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

/** Encodes points as a Google encoded polyline (precision 5). */
export function encodePolyline(points: LatLng[]): string {
  let out = '';
  let prevLat = 0;
  let prevLng = 0;
  const enc = (v: number) => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    let s = '';
    while (n >= 0x20) {
      s += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
      n >>= 5;
    }
    return s + String.fromCharCode(n + 63);
  };
  for (const p of points) {
    const lat = Math.round(p.lat * 1e5);
    const lng = Math.round(p.lng * 1e5);
    out += enc(lat - prevLat) + enc(lng - prevLng);
    prevLat = lat;
    prevLng = lng;
  }
  return out;
}
