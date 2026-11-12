import {
  asLocale,
  formatDate,
  formatDateTime,
  formatMoney,
  formatTime,
  type FormatMoneyOptions,
} from '@tezfiks/shared';

/** Money in qəpik (integer minor units) -> "1.420,00 ₼" (az) / "1 420,00 ₼" (ru) / "₼1,420.00" (en). */
export function moneyText(
  minor: number | null | undefined,
  locale: string,
  opts: FormatMoneyOptions = {},
): string {
  if (minor === null || minor === undefined || !Number.isFinite(minor)) return '—';
  return formatMoney(Math.trunc(minor), asLocale(locale), opts);
}

export type DateTimeMode = 'datetime' | 'date' | 'time';

/** Dates are always shown in Baku time (UTC+4), whatever the browser or server time zone is. */
export function dateTimeText(
  value: string | Date | number | null | undefined,
  mode: DateTimeMode = 'datetime',
): string {
  if (value === null || value === undefined || value === '') return '—';
  const ms = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(ms)) return '—';
  if (mode === 'date') return formatDate(ms);
  if (mode === 'time') return formatTime(ms);
  return formatDateTime(ms);
}

/** "6,3%" (az/ru) or "6.3%" (en) from a 0..1 ratio. */
export function percentText(ratio: number | null | undefined, locale: string, digits = 1): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return '—';
  const text = (ratio * 100).toFixed(digits);
  return `${asLocale(locale) === 'en' ? text : text.replace('.', ',')}%`;
}
