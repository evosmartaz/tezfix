import { formatMoney, formatPhoneAsYouType, normalizeAzMobile, secondsLeft, toMinor, type Locale } from '@tezfiks/shared';

/** National significant number length of Azerbaijani numbers (50 123 45 67). */
export const AZ_NSN_LENGTH = 9;
export const AZ_COUNTRY_PREFIX = '+994';

/**
 * Reduces any typed or pasted phone text to the 9 national digits shown next to the +994 chip.
 * Accepts "050 123 45 67", "+994 50 123 45 67", "00994501234567", "994501234567", "50-123-45-67".
 */
export function sanitizeAzPhoneDigits(text: string): string {
  const raw = text ?? '';
  let d = raw.replace(/\D/g, '');
  if (/^00994/.test(d)) d = d.slice(5);
  else if (d.startsWith('994') && (raw.trim().startsWith('+') || d.length >= 12)) d = d.slice(3);
  d = d.replace(/^0+/, '');
  return d.slice(0, AZ_NSN_LENGTH);
}

/** Formats national digits while typing: "501234567" -> "50 123 45 67", "5012" -> "50 12". */
export function formatAzNational(digits: string): string {
  const d = digits.replace(/\D/g, '').slice(0, AZ_NSN_LENGTH);
  if (!d) return '';
  const formatted = formatPhoneAsYouType(`0${d}`).replace(/[()]/g, '').trim();
  return formatted.replace(/^0/, '').replace(/\s+/g, ' ').trim();
}

/** Full E.164 number for 9 national digits, or null when not a valid Azerbaijani mobile number. */
export function azDigitsToE164(digits: string): string | null {
  if (digits.length !== AZ_NSN_LENGTH) return null;
  return normalizeAzMobile(`${AZ_COUNTRY_PREFIX}${digits}`);
}

/** Uppercases Azerbaijani letters without relying on Intl locale data (Hermes): i -> İ, ı -> I. */
export function upperAzSafe(input: string): string {
  return input.replace(/i/g, 'İ').replace(/ı/g, 'I').toUpperCase();
}

/** Avatar initials: "İlkin", "Əliyev" -> "İƏ"; "ilqar" -> "İ"; empty -> "". */
export function initialsOf(firstName?: string | null, lastName?: string | null): string {
  const a = Array.from((firstName ?? '').trim())[0] ?? '';
  const b = Array.from((lastName ?? '').trim())[0] ?? '';
  return upperAzSafe(`${a}${b}`);
}

/** "mm:ss" (or "h:mm:ss" from one hour) for a number of seconds; negatives clamp to 0. */
export function formatCountdown(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/** Seconds left until a server deadline, corrected by the server clock offset (serverNow - clientNow). */
export function countdownSeconds(deadline: string | Date | number, clockOffsetMs = 0, now: number = Date.now()): number {
  const d = typeof deadline === 'number' ? new Date(deadline) : deadline;
  return secondsLeft(d, clockOffsetMs, now);
}

/** Progress 0..1 of a countdown window of `totalSec` (1 = full time left). */
export function countdownProgress(left: number, totalSec: number): number {
  if (totalSec <= 0) return 0;
  return Math.min(1, Math.max(0, left / totalSec));
}

export type KeypadKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '.' | 'back';

export interface KeypadOptions {
  /** Max digits before the decimal point (default 6 → up to 999 999,99 AZN). */
  maxIntDigits?: number;
  /** Max digits after the decimal point (default 2: qəpik). */
  decimals?: number;
}

/** Applies one keypad press to a decimal amount string ("45.5"). Pure; used by the board 03 "İşi tamamla" keypad. */
export function applyKeypadKey(value: string, key: KeypadKey, opts: KeypadOptions = {}): string {
  const maxInt = opts.maxIntDigits ?? 6;
  const decimals = opts.decimals ?? 2;
  if (key === 'back') return value.slice(0, -1);
  const [intPart, fracPart] = value.split('.');
  if (key === '.') {
    if (decimals === 0 || value.includes('.')) return value;
    return value === '' ? '0.' : `${value}.`;
  }
  if (fracPart !== undefined) {
    if (fracPart.length >= decimals) return value;
    return value + key;
  }
  if (intPart === '0') return key;
  if (intPart.length >= maxInt) return value;
  return value + key;
}

/** Keypad string → integer qəpik ("" → 0, "12." → 1200, "4.5" → 450). */
export function keypadToMinor(value: string): number {
  if (!value || value === '.') return 0;
  return toMinor(value.endsWith('.') ? value.slice(0, -1) : value);
}

/** Integer qəpik → keypad string (1200 → "12", 450 → "4.5", 405 → "4.05"). */
export function minorToKeypad(minor: number): string {
  if (!minor) return '';
  const int = Math.floor(minor / 100);
  const frac = minor % 100;
  if (frac === 0) return String(int);
  return `${int}.${String(frac).padStart(2, '0').replace(/0$/, '')}`;
}

/** formatMoney re-export with the UI defaults. */
export function money(minor: number, locale: Locale, opts?: Parameters<typeof formatMoney>[2]): string {
  return formatMoney(minor, locale, opts);
}
