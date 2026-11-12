import { parsePhoneNumberFromString, AsYouType, type CountryCode } from 'libphonenumber-js/max';

export interface NormalizePhoneOptions {
  defaultCountry?: CountryCode;
  /** Only these countries are accepted (demo: Azerbaijan only). */
  allowedCountries?: CountryCode[];
  /** Require a mobile number (OTP logins). */
  mobileOnly?: boolean;
}

/**
 * Normalizes user input to E.164 ("+994501234567") or returns null when invalid.
 * Accepts "050 123 45 67", "0501234567", "994501234567", "+994 50 123 45 67", "50 123 45 67".
 */
export function normalizePhone(input: string, opts: NormalizePhoneOptions = {}): string | null {
  const defaultCountry = opts.defaultCountry ?? 'AZ';
  const allowed = opts.allowedCountries ?? ['AZ'];
  const mobileOnly = opts.mobileOnly ?? true;
  let raw = (input ?? '').trim();
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, '');
  if (/^994\d{9}$/.test(digits)) raw = '+' + digits;
  else if (/^\d{9}$/.test(digits) && defaultCountry === 'AZ') raw = '0' + digits;
  const parsed = parsePhoneNumberFromString(raw, defaultCountry);
  if (!parsed || !parsed.isValid()) return null;
  if (!parsed.country || !allowed.includes(parsed.country)) return null;
  if (mobileOnly) {
    const type = parsed.getType();
    if (type !== 'MOBILE' && type !== 'FIXED_LINE_OR_MOBILE') return null;
  }
  return parsed.number;
}

/** Azerbaijani mobile number shortcut used by OTP login. */
export function normalizeAzMobile(input: string): string | null {
  return normalizePhone(input, { defaultCountry: 'AZ', allowedCountries: ['AZ'], mobileOnly: true });
}

/** "+994501234567" -> national "050 123 45 67" or international "+994 50 123 45 67". */
export function formatPhone(e164: string, style: 'national' | 'international' = 'national'): string {
  const parsed = parsePhoneNumberFromString(e164);
  if (!parsed) return e164;
  return style === 'national' ? parsed.formatNational() : parsed.formatInternational();
}

/** Formats partial input while typing (country AZ). */
export function formatPhoneAsYouType(input: string, country: CountryCode = 'AZ'): string {
  return new AsYouType(country).input(input);
}

/** Masks a phone for logs and lists: "+99450*****67". */
export function maskPhone(e164: string): string {
  if (e164.length < 6) return '***';
  return `${e164.slice(0, 6)}*****${e164.slice(-2)}`;
}
