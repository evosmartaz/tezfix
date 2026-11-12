/**
 * Privacy guard for notifications and push payloads (spec §4.4): phone numbers and exact addresses never leave in
 * notification data, titles, bodies or push payloads. Callers should pass ids and amounts only; this is the safety net.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** +994 50 123 45 67, 994501234567, (050) 123-45-67, 050 123 45 67, 0501234567 */
const PHONE = /(?:\+?994[\s-]?\(?\d{2}\)?|\(?0\d{2}\)?)[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}(?!\d)/g;
/** Azerbaijani numbers written without 0/994: 50 123 45 67, 501234567, (55) 123-45-67 (mobile and Baku/landline codes). */
const LOCAL_PHONE = /(?<![\w+])\(?(?:10|12|50|51|55|60|70|77|99)\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}(?![\w])/g;
const PHONE_KEY = /phone|msisdn|whatsapp/i;
const ADDRESS_KEY = /address|apartment|intercom|entrance|formatted/i;

export const REDACTED = '•••';

export function redactPhones(text: string): string {
  if (UUID.test(text)) return text;
  return text.replace(PHONE, REDACTED).replace(LOCAL_PHONE, REDACTED);
}

function isSensitiveKey(key: string): boolean {
  if (PHONE_KEY.test(key)) return true;
  return ADDRESS_KEY.test(key) && !/Id$/.test(key);
}

function clean(value: unknown, depth: number): unknown {
  if (depth > 6) return undefined;
  if (typeof value === 'string') return redactPhones(value);
  if (Array.isArray(value)) return value.map((v) => clean(v, depth + 1));
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(k) || v === undefined) continue;
      out[k] = clean(v, depth + 1);
    }
    return out;
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return Number(value);
  return value;
}

/** Drops phone/address keys and redacts phone-like strings, recursively. Returns a JSON-safe copy. */
export function sanitizeData(data: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!data) return {};
  return clean(data, 0) as Record<string, unknown>;
}

/** Redacts phone-like strings in translation variables. */
export function sanitizeVars(vars: Record<string, string | number> | undefined): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(vars ?? {})) out[k] = typeof v === 'string' ? redactPhones(v) : v;
  return out;
}
