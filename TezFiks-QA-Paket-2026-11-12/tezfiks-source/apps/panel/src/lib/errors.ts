import { ApiError, ERROR_CODES } from '@tezfiks/shared';

/** Codes that have a translation under `common.errors.*` (API codes plus the client-side NETWORK / TIMEOUT). */
const TRANSLATED = new Set<string>([...ERROR_CODES, 'NETWORK', 'TIMEOUT']);

export type ActionResult<T = undefined> =
  { ok: true; data: T } | { ok: false; code: string; message: string; details?: unknown };

/** Error code of anything thrown while calling the API. */
export function errorCode(err: unknown): string {
  if (err instanceof ApiError) return String(err.code);
  return 'INTERNAL';
}

/** Translation key (relative to the `common` namespace) for an error code. Unknown codes map to INTERNAL. */
export function errorMessageKey(code: string): `errors.${string}` {
  return `errors.${TRANSLATED.has(code) ? code : 'INTERNAL'}`;
}

/**
 * Turns an API failure into a serializable action result. API errors already carry a message localized by Accept-Language;
 * transport failures (and unknown errors) use the panel translation.
 */
export function toActionError(
  err: unknown,
  translate: (key: `errors.${string}`) => string,
): Extract<ActionResult, { ok: false }> {
  const code = errorCode(err);
  const useApiMessage =
    err instanceof ApiError && err.status > 0 && TRANSLATED.has(code) && code !== 'INTERNAL' && err.message;
  return {
    ok: false,
    code,
    message: useApiMessage ? err.message : translate(errorMessageKey(code)),
    details: err instanceof ApiError ? err.details : undefined,
  };
}

/** Next.js navigation (redirect / notFound) is implemented with throws that must propagate out of actions. */
export function isNavigationError(err: unknown): boolean {
  const digest =
    typeof err === 'object' && err !== null && 'digest' in err
      ? String((err as { digest: unknown }).digest)
      : '';
  return (
    digest.startsWith('NEXT_REDIRECT') ||
    digest.startsWith('NEXT_HTTP_ERROR_FALLBACK') ||
    digest === 'NEXT_NOT_FOUND'
  );
}
