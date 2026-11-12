/** Panel runtime configuration. Server-only values are read lazily so tests can change process.env. */

export const BASE_PATH = '/tezfix';
export const DEFAULT_API_INTERNAL_URL = 'http://127.0.0.1:3000/tezfix/api';
export const SOCKET_PATH = '/tezfix/api/socket.io';
export const PRO_APP_SCHEME = 'tezfiksusta';
/** Placeholder until the Play Store listing exists (spec §19). */
export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=az.tezfiks.usta';
/** Direct APK download of TezFiks Usta (deploy/web/download, served on tezfiks.evosmart.az) until the store listing exists. */
export const PRO_APP_DOWNLOAD_URL = 'https://tezfiks.evosmart.az/download/tezfiks-usta.apk';

/** API base used by Server Actions, Server Components, route handlers and the proxy (server to server). */
export function apiInternalUrl(): string {
  return (process.env.API_INTERNAL_URL || DEFAULT_API_INTERNAL_URL).replace(/\/+$/, '');
}

/** Cookies get `Secure` in production unless explicitly disabled (plain-HTTP staging). */
export function secureCookies(): boolean {
  if (process.env.COOKIE_SECURE === 'false') return false;
  if (process.env.COOKIE_SECURE === 'true') return true;
  return process.env.NODE_ENV === 'production';
}

/** Validate API responses against the contract outside production (catches drift early). */
export function validateApiResponses(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.PANEL_VALIDATE_RESPONSES !== 'false';
}

/** Browser Socket.IO origin. Empty means "same origin as the page". */
export function publicSocketUrl(): string {
  return process.env.NEXT_PUBLIC_SOCKET_URL ?? '';
}

export function googleMapsBrowserKey(): string {
  return process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY ?? '';
}
