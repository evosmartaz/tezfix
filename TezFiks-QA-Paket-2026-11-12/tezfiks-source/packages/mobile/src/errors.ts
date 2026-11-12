import { ApiError, ERROR_CODES } from '@tezfiks/shared';

/** Client-side codes produced by the API client itself (no HTTP response). */
export const CLIENT_ERROR_CODES = ['NETWORK', 'TIMEOUT'] as const;

const KNOWN = new Set<string>([...ERROR_CODES, ...CLIENT_ERROR_CODES]);

/** Error code of anything thrown by API calls; unknown errors map to INTERNAL. */
export function errorCodeOf(err: unknown): string {
  if (err instanceof ApiError || (err && typeof err === 'object' && 'code' in err && typeof (err as { code: unknown }).code === 'string')) {
    const code = (err as { code: string }).code;
    return KNOWN.has(code) ? code : 'INTERNAL';
  }
  return 'INTERNAL';
}

/** i18next key for an error: "common:errors.<CODE>" (namespace "common", section "errors"). */
export function errorMessageKey(err: unknown): string {
  return `common:errors.${errorCodeOf(err)}`;
}

/** Localized error message through a `t` function. */
export function errorMessage(t: (key: string) => string, err: unknown): string {
  return t(errorMessageKey(err));
}

/** True for errors that mean "the session is gone": the app returns to login. */
export function isAuthError(err: unknown): boolean {
  const code = errorCodeOf(err);
  return code === 'UNAUTHORIZED' || code === 'SESSION_REVOKED' || code === 'REFRESH_INVALID' || code === 'USER_BLOCKED';
}

/** True for connectivity failures (worth a retry button). */
export function isNetworkError(err: unknown): boolean {
  const code = errorCodeOf(err);
  return code === 'NETWORK' || code === 'TIMEOUT';
}
