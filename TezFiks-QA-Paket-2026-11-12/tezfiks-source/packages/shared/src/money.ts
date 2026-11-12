import type { Locale } from './enums';

export const CURRENCY = 'AZN';
export const MINOR_PER_MAJOR = 100;
const NBSP = ' ';
const SYMBOLS: Record<string, string> = { AZN: '₼' };

/** Converts a major-unit amount ("12.5", "12,50", 12.5) to integer minor units (qəpik). Throws on invalid input. */
export function toMinor(major: number | string): number {
  const text = typeof major === 'number' ? String(major) : major.trim().replace(/\s/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d{0,2})?$/.test(text)) throw new Error(`Invalid money amount: ${String(major)}`);
  const negative = text.startsWith('-');
  const [intPart, fracPart = ''] = text.replace('-', '').split('.');
  const minor = Number(intPart) * MINOR_PER_MAJOR + Number((fracPart + '00').slice(0, 2));
  return negative ? -minor : minor;
}

/** Converts integer minor units to a major-unit number (1250 -> 12.5). */
export function toMajor(minor: number): number {
  return minor / MINOR_PER_MAJOR;
}

export interface FormatMoneyOptions {
  currency?: string;
  /** Drop ",00" for whole amounts ("10 ₼"). */
  compact?: boolean;
  /** Prefix positive amounts with "+". */
  sign?: boolean;
  /** Omit the currency symbol. */
  plain?: boolean;
}

function group(intDigits: string, sep: string): string {
  return intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

/**
 * Deterministic money formatting (no Intl dependency, identical on Hermes and Node).
 * az: "1.234,50 ₼"   ru: "1 234,50 ₼"   en: "₼1,234.50"  (spaces are non-breaking)
 */
export function formatMoney(minor: number, locale: Locale, opts: FormatMoneyOptions = {}): string {
  const currency = opts.currency ?? CURRENCY;
  const symbol = SYMBOLS[currency] ?? currency;
  const negative = minor < 0;
  const abs = Math.abs(Math.trunc(minor));
  const intDigits = String(Math.floor(abs / MINOR_PER_MAJOR));
  const frac = String(abs % MINOR_PER_MAJOR).padStart(2, '0');
  const showFrac = !(opts.compact && frac === '00');
  const sign = negative ? '-' : opts.sign && minor > 0 ? '+' : '';
  let number: string;
  if (locale === 'en') {
    number = group(intDigits, ',') + (showFrac ? `.${frac}` : '');
    if (opts.plain) return sign + number;
    return `${sign}${symbol}${number}`;
  }
  number = group(intDigits, locale === 'ru' ? NBSP : '.') + (showFrac ? `,${frac}` : '');
  if (opts.plain) return sign + number;
  return `${sign}${number}${NBSP}${symbol}`;
}
