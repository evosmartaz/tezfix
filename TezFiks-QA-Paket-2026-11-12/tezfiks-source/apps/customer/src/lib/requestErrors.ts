import { ERROR_CODES } from '@tezfiks/shared';
import type { RequestFormField } from './requestPayload';

/** What the UI offers next to an API error message. */
export type ErrorAction = 'topUp' | 'business' | 'retry' | null;

export interface RequestErrorInfo {
  code: string;
  /** i18next key of the message (common:errors.<CODE>). */
  messageKey: string;
  action: ErrorAction;
  /** Form field the error belongs to, when it maps to one. */
  field: RequestFormField | null;
}

/**
 * Every code with a localized message in common.errors: the whole shared ERROR_CODES list (USER_BLOCKED,
 * PROFILE_INCOMPLETE, NOT_ELIGIBLE, ... can come back from create / cancel / classify too) plus the client-side
 * connectivity codes of the API client.
 */
const KNOWN_CODES: ReadonlySet<string> = new Set<string>([...ERROR_CODES, 'NETWORK', 'TIMEOUT']);

/** details.reason of the CONFLICT the idempotency interceptor returns while the first call with the same key still runs. */
export const REQUEST_IN_PROGRESS = 'REQUEST_IN_PROGRESS';

const FIELD_BY_CODE: Record<string, RequestFormField> = {
  SCHEDULE_TOO_SOON: 'scheduledAt',
  SCHEDULE_TOO_FAR: 'scheduledAt',
  EMERGENCY_NOT_ALLOWED: 'timing',
  INSUFFICIENT_BALANCE: 'timing',
  CATEGORY_INACTIVE: 'category',
  CATEGORY_REQUIRES_QUOTE: 'category',
  CATEGORY_NOT_INSTANT: 'category',
  FILE_NOT_OWNED: 'photos',
  FILE_TYPE_NOT_ALLOWED: 'photos',
};

function reasonOf(err: unknown): string | null {
  const details = err && typeof err === 'object' && 'details' in err ? (err as { details: unknown }).details : null;
  const reason = details && typeof details === 'object' && 'reason' in details ? (details as { reason: unknown }).reason : null;
  return typeof reason === 'string' ? reason : null;
}

/** CONFLICT {reason: REQUEST_IN_PROGRESS}: the server is still processing an earlier call with the same Idempotency-Key. */
export function isRequestInProgress(err: unknown): boolean {
  return codeOf(err) === 'CONFLICT' && reasonOf(err) === REQUEST_IN_PROGRESS;
}

function codeOf(err: unknown): string {
  const code = err && typeof err === 'object' && 'code' in err ? (err as { code: unknown }).code : null;
  return typeof code === 'string' && (KNOWN_CODES.has(code) || /^[A-Z_]+$/.test(code)) ? code : 'INTERNAL';
}

/**
 * Maps an error from POST /requests (or cancel / classify) to a localized message and the follow-up the app offers:
 * debt or a short wallet → top up (wallet tab), a quote-only category → business request, connectivity → retry.
 */
export function requestErrorInfo(err: unknown): RequestErrorInfo {
  const code = codeOf(err);
  if (isRequestInProgress(err)) return { code, messageKey: 'request.inProgress', action: null, field: null };
  const messageCode = KNOWN_CODES.has(code) ? code : 'INTERNAL';
  let action: ErrorAction = null;
  if (code === 'CUSTOMER_IN_DEBT' || code === 'INSUFFICIENT_BALANCE') action = 'topUp';
  else if (code === 'CATEGORY_REQUIRES_QUOTE') action = 'business';
  else if (code === 'NETWORK' || code === 'TIMEOUT') action = 'retry';
  return { code, messageKey: `common:errors.${messageCode}`, action, field: FIELD_BY_CODE[code] ?? null };
}

/**
 * A retry after these errors must reuse the same Idempotency-Key: the server may or may not have stored the request
 * (connectivity, 5xx), or is still processing the first call with this key (CONFLICT REQUEST_IN_PROGRESS).
 */
export function isRetryableWithSameKey(err: unknown): boolean {
  const code = codeOf(err);
  return code === 'NETWORK' || code === 'TIMEOUT' || code === 'INTERNAL' || isRequestInProgress(err);
}
