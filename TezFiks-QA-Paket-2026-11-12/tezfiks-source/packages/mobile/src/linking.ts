import { Linking } from 'react-native';
import type { MobileApp } from './runtime';

export const APP_SCHEMES: Record<MobileApp, string> = { CUSTOMER: 'tezfiks', PRO: 'tezfiksusta' };

/** Public web base that may carry app links (invite pages are served by the panel at /tezfix/join/<token>). */
export const WEB_LINK_PREFIX = 'https://evosmart.az/tezfix';

export interface ParsedLink {
  scheme: string;
  /** Path segments without the scheme/host prefix: tezfiksusta://join/abc → ['join', 'abc']. */
  segments: string[];
  query: Record<string, string>;
}

function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** "tezfiksusta://join/abc" or "tezfiksusta:///join/abc". */
export function buildDeepLink(app: MobileApp, path: string, query?: Record<string, string | number | undefined>): string {
  const clean = path.replace(/^\/+/, '');
  const qs = query
    ? Object.entries(query)
        .filter(([, v]) => v !== undefined && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&')
    : '';
  return `${APP_SCHEMES[app]}://${clean}${qs ? `?${qs}` : ''}`;
}

/** Parses app-scheme links and https links under WEB_LINK_PREFIX. Returns null for anything else. */
export function parseDeepLink(url: string): ParsedLink | null {
  const m = /^([a-z][a-z0-9+.-]*):\/\/([^?#]*)(\?[^#]*)?/i.exec((url ?? '').trim());
  if (!m) return null;
  const scheme = m[1].toLowerCase();
  let rest = m[2];
  if (scheme === 'http' || scheme === 'https') {
    const prefix = WEB_LINK_PREFIX.replace(/^https?:\/\//, '');
    if (!rest.toLowerCase().startsWith(prefix.toLowerCase())) return null;
    rest = rest.slice(prefix.length);
  }
  const segments = rest.split('/').filter(Boolean).map(decode);
  const query: Record<string, string> = {};
  if (m[3]) {
    for (const part of m[3].slice(1).split('&')) {
      if (!part) continue;
      const [k, v = ''] = part.split('=');
      query[decode(k)] = decode(v.replace(/\+/g, ' '));
    }
  }
  return { scheme, segments, query };
}

/** Company invite token from "tezfiksusta://join/<token>" or "https://evosmart.az/tezfix/join/<token>". */
export function inviteTokenFromUrl(url: string): string | null {
  const link = parseDeepLink(url);
  if (!link) return null;
  if (link.scheme !== APP_SCHEMES.PRO && link.scheme !== 'http' && link.scheme !== 'https') return null;
  if (link.segments[0] !== 'join' || !link.segments[1]) return null;
  return link.segments[1];
}

/** Turn-by-turn navigation deep links (spec §12). */
export function googleNavigationUrl(lat: number, lng: number): string {
  return `google.navigation:q=${lat},${lng}`;
}

export function wazeUrl(lat: number, lng: number): string {
  return `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;
}

export function googleMapsWebUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

/**
 * Opens Google Maps navigation, falling back to the web directions page. Opens directly instead of asking
 * canOpenURL first: on Android, openURL rejects when no app handles the scheme, which works even without a
 * <queries> entry (the apps declare one anyway via plugins/with-navigation-queries).
 */
export async function openNavigation(lat: number, lng: number): Promise<void> {
  try {
    await Linking.openURL(googleNavigationUrl(lat, lng));
    return;
  } catch {
    // no Google Maps app: fall back below
  }
  await Linking.openURL(googleMapsWebUrl(lat, lng));
}

export async function openWaze(lat: number, lng: number): Promise<void> {
  await Linking.openURL(wazeUrl(lat, lng));
}
