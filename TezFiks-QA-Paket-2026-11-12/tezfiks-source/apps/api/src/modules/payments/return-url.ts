import type { Env } from '../../config/env';

/**
 * Fixed Expo development schemes (Expo Go over http/https and the two dev clients). Development tooling only: anyone can
 * open an exp:// link in Expo Go, so production never redirects to them.
 */
const EXPO_SCHEMES = ['exp', 'exps', 'exp+tezfiks', 'exp+tezfiks-usta'];

function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null;
  } catch {
    return null;
  }
}

/**
 * Allow-list for checkout return URLs (no open redirect): the app deep-link schemes, the Expo dev schemes (not in
 * production), and http(s) URLs whose origin is PUBLIC_BASE_URL or one of CORS_ORIGINS. Anything else returns null (dropped).
 */
export function sanitizeReturnUrl(
  raw: string | null | undefined,
  env: Pick<Env, 'APP_SCHEME_CUSTOMER' | 'APP_SCHEME_PRO' | 'PUBLIC_BASE_URL' | 'CORS_ORIGINS'> & { NODE_ENV?: Env['NODE_ENV'] },
): string | null {
  if (!raw) return null;
  const url = raw.trim();
  if (!url || url.length > 500) return null;
  // Control characters, whitespace and backslashes are never needed and enable parser confusion.
  if (/[\s\\\u0000-\u001f\u007f]/.test(url)) return null;
  const lower = url.toLowerCase();
  const devSchemes = env.NODE_ENV === 'production' ? [] : EXPO_SCHEMES;
  const schemes = [env.APP_SCHEME_CUSTOMER, env.APP_SCHEME_PRO, ...devSchemes].map(
    (s) => `${s.toLowerCase()}://`,
  );
  if (schemes.some((s) => lower.startsWith(s) && lower.length > s.length)) return url;
  if (!lower.startsWith('http://') && !lower.startsWith('https://')) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.username || parsed.password) return null;
  const allowed = new Set(
    [env.PUBLIC_BASE_URL, ...env.CORS_ORIGINS].map(originOf).filter((o): o is string => !!o),
  );
  return allowed.has(parsed.origin) ? parsed.toString() : null;
}

/** Appends paymentIntentId and status as query params (before any #fragment). */
export function withPaymentResult(url: string, paymentIntentId: string, status: string): string {
  const hashAt = url.indexOf('#');
  const base = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const hash = hashAt >= 0 ? url.slice(hashAt) : '';
  const sep = !base.includes('?') ? '?' : base.endsWith('?') || base.endsWith('&') ? '' : '&';
  return `${base}${sep}paymentIntentId=${encodeURIComponent(paymentIntentId)}&status=${encodeURIComponent(status)}${hash}`;
}
