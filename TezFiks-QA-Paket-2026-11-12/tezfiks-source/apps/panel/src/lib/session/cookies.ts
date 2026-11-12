/**
 * Pure cookie and token helpers for the BFF session (no Next.js imports: used by the proxy, server code and tests).
 * Tokens live only in httpOnly cookies scoped to the basePath; the browser never sees them.
 */
import type { AuthTokens } from '@tezfiks/shared';
import { BASE_PATH } from '../env';

export const ACCESS_COOKIE = 'tf_at';
export const REFRESH_COOKIE = 'tf_rt';
export const KIND_COOKIE = 'tf_kind';
/** Stable per-browser device id sent with OTP verify / refresh (sessions are bound to a device). */
export const DEVICE_COOKIE = 'tf_did';
export const LOCALE_COOKIE = 'locale';

export const SESSION_COOKIES = [ACCESS_COOKIE, REFRESH_COOKIE, KIND_COOKIE] as const;

export type SessionKind = 'admin' | 'company';

/** Refresh the access token when it expires within this window. */
export const ACCESS_REFRESH_SKEW_MS = 30_000;
const DEVICE_MAX_AGE_SEC = 400 * 24 * 3600;
const LOCALE_MAX_AGE_SEC = 365 * 24 * 3600;

export interface CookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax';
  path: string;
  expires?: Date;
  maxAge?: number;
}

export interface CookieToSet {
  name: string;
  value: string;
  options: CookieOptions;
}

export function isSessionKind(value: unknown): value is SessionKind {
  return value === 'admin' || value === 'company';
}

export function baseCookieOptions(secure: boolean): CookieOptions {
  return { httpOnly: true, secure, sameSite: 'lax', path: BASE_PATH };
}

/** The three session cookies for a freshly issued token pair. */
export function sessionCookies(tokens: AuthTokens, kind: SessionKind, secure: boolean): CookieToSet[] {
  const base = baseCookieOptions(secure);
  const accessExpires = new Date(tokens.accessExpiresAt);
  const refreshExpires = new Date(tokens.refreshExpiresAt);
  return [
    { name: ACCESS_COOKIE, value: tokens.accessToken, options: { ...base, expires: accessExpires } },
    { name: REFRESH_COOKIE, value: tokens.refreshToken, options: { ...base, expires: refreshExpires } },
    { name: KIND_COOKIE, value: kind, options: { ...base, expires: refreshExpires } },
  ];
}

/** Cookies that delete the session (expired, same path). */
export function clearedSessionCookies(secure: boolean): CookieToSet[] {
  const base = baseCookieOptions(secure);
  return SESSION_COOKIES.map((name) => ({
    name,
    value: '',
    options: { ...base, expires: new Date(0), maxAge: 0 },
  }));
}

export function deviceCookie(deviceId: string, secure: boolean): CookieToSet {
  return {
    name: DEVICE_COOKIE,
    value: deviceId,
    options: { ...baseCookieOptions(secure), maxAge: DEVICE_MAX_AGE_SEC },
  };
}

/** The language cookie is readable by the browser (not a secret) so the switcher can render instantly. */
export function localeCookie(locale: string, secure: boolean): CookieToSet {
  return {
    name: LOCALE_COOKIE,
    value: locale,
    options: { ...baseCookieOptions(secure), httpOnly: false, maxAge: LOCALE_MAX_AGE_SEC },
  };
}

export function isValidDeviceId(value: string | undefined | null): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value);
}

export function newDeviceId(): string {
  return `web-${crypto.randomUUID()}`;
}

function base64UrlDecode(segment: string): string {
  const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return atob(padded);
}

/** `exp` (ms since epoch) of a JWT without verifying it (the API verifies). Null when unreadable. */
export function jwtExpiryMs(token: string | undefined | null): number | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(base64UrlDecode(parts[1])) as { exp?: unknown };
    return typeof payload.exp === 'number' && Number.isFinite(payload.exp) ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

/** True when the access token exists and stays valid for at least `skewMs`. */
export function isAccessTokenFresh(
  token: string | undefined | null,
  nowMs: number,
  skewMs = ACCESS_REFRESH_SKEW_MS,
): boolean {
  const exp = jwtExpiryMs(token);
  return exp !== null && exp - skewMs > nowMs;
}

export interface SessionCookieValues {
  accessToken?: string;
  refreshToken?: string;
  kind?: string;
}

export type SessionState =
  | { status: 'none' }
  | { status: 'active'; kind: SessionKind; accessToken: string }
  | { status: 'refresh'; kind: SessionKind; refreshToken: string };

/** What the request carries: a usable access token, only a refresh token, or nothing usable. */
export function sessionState(values: SessionCookieValues, nowMs: number): SessionState {
  if (!isSessionKind(values.kind)) return { status: 'none' };
  if (values.accessToken && isAccessTokenFresh(values.accessToken, nowMs)) {
    return { status: 'active', kind: values.kind, accessToken: values.accessToken };
  }
  if (values.refreshToken) return { status: 'refresh', kind: values.kind, refreshToken: values.refreshToken };
  return { status: 'none' };
}

/** Panel area of a path (without basePath). */
export type PanelArea = 'admin' | 'company' | 'bff' | 'public';

export function panelArea(pathname: string): PanelArea {
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return 'admin';
  if (pathname === '/company' || pathname.startsWith('/company/')) return 'company';
  if (pathname.startsWith('/bff/')) return 'bff';
  return 'public';
}

/** Login pages are public even inside protected areas. */
export function isLoginPath(pathname: string): boolean {
  return pathname === '/admin/login' || pathname === '/company/login';
}

export function loginPathFor(kind: SessionKind): string {
  return kind === 'admin' ? '/admin/login' : '/company/login';
}

/** Only same-app relative paths are accepted as post-login targets (no open redirects). */
export function safeNextPath(value: string | null | undefined, kind: SessionKind): string {
  const fallback = kind === 'admin' ? '/admin' : '/company';
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback;
  const area = panelArea(value.split('?')[0]);
  if (area !== kind || isLoginPath(value.split('?')[0])) return fallback;
  return value;
}
