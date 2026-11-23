import Constants from 'expo-constants';

/** Android emulator alias for the host machine (spec: dev API on the host). */
export const DEFAULT_API_URL = 'http://10.0.2.2:3000/tezfix/api';

/** Mapbox style of the map tiles unless EXPO_PUBLIC_MAPBOX_STYLE names another (e.g. a Mapbox Studio style). */
export const MAPBOX_DEFAULT_STYLE = 'mapbox/streets-v12';

export interface MobileExtra {
  apiUrl: string;
  /** True when GOOGLE_MAPS_ANDROID_KEY was set at build time; otherwise maps use OpenStreetMap tiles. */
  hasGoogleMapsKey: boolean;
  /** Mapbox public token (EXPO_PUBLIC_MAPBOX_TOKEN at build time); when set, maps use Mapbox tiles. */
  mapboxToken: string | null;
  /** Mapbox style id ("owner/style") of those tiles. */
  mapboxStyle: string;
}

/** Reads `expo.extra` written by app.config.ts. */
export function getExtra(): MobileExtra {
  const extra = (Constants.expoConfig?.extra ?? {}) as Partial<MobileExtra>;
  return {
    apiUrl: typeof extra.apiUrl === 'string' && extra.apiUrl ? extra.apiUrl : DEFAULT_API_URL,
    hasGoogleMapsKey: extra.hasGoogleMapsKey === true,
    mapboxToken: typeof extra.mapboxToken === 'string' && extra.mapboxToken ? extra.mapboxToken : null,
    mapboxStyle: typeof extra.mapboxStyle === 'string' && extra.mapboxStyle ? extra.mapboxStyle : MAPBOX_DEFAULT_STYLE,
  };
}

export function getApiUrl(): string {
  return getExtra().apiUrl;
}

/**
 * Splits an absolute URL into origin and pathname without relying on the WHATWG URL
 * implementation (React Native's URL polyfill does not implement every getter).
 */
export function splitUrl(url: string): { origin: string; pathname: string } {
  const m = /^([a-z][a-z0-9+.-]*:\/\/[^/?#]+)([^?#]*)/i.exec(url.trim());
  if (!m) throw new Error(`Invalid absolute URL: ${url}`);
  const pathname = (m[2] || '/').replace(/\/+$/, '');
  return { origin: m[1], pathname: pathname || '' };
}

/** Socket.IO endpoint for an API base: same origin, path `<api pathname>/socket.io`. */
export function socketEndpoint(apiUrl: string): { url: string; path: string } {
  const { origin, pathname } = splitUrl(apiUrl);
  return { url: origin, path: `${pathname}/socket.io` };
}
