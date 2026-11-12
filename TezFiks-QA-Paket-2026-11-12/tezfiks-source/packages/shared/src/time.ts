import type { Locale } from './enums';

export const BAKU_TZ = 'Asia/Baku';
/** Azerbaijan has been fixed at UTC+4 without DST since 2016. */
export const BAKU_OFFSET_MINUTES = 240;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function shifted(input: string | Date | number, offsetMinutes: number): Date {
  const ms = input instanceof Date ? input.getTime() : typeof input === 'number' ? input : Date.parse(input);
  return new Date(ms + offsetMinutes * 60_000);
}

/** "24.10.2026" in Baku time. Same pattern for az, ru and en inside Azerbaijan. */
export function formatDate(input: string | Date | number, offsetMinutes = BAKU_OFFSET_MINUTES): string {
  const d = shifted(input, offsetMinutes);
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
}

/** "18:05" in Baku time (24h). */
export function formatTime(input: string | Date | number, offsetMinutes = BAKU_OFFSET_MINUTES): string {
  const d = shifted(input, offsetMinutes);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** "24.10.2026, 18:05" in Baku time. */
export function formatDateTime(
  input: string | Date | number,
  _locale?: Locale,
  offsetMinutes = BAKU_OFFSET_MINUTES,
): string {
  return `${formatDate(input, offsetMinutes)}, ${formatTime(input, offsetMinutes)}`;
}

/** Baku-local calendar day key "2026-10-24". */
export function bakuDayKey(input: string | Date | number, offsetMinutes = BAKU_OFFSET_MINUTES): string {
  const d = shifted(input, offsetMinutes);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** UTC instant of the start of the Baku-local day containing `input`. */
export function startOfBakuDay(input: string | Date | number, offsetMinutes = BAKU_OFFSET_MINUTES): Date {
  const d = shifted(input, offsetMinutes);
  const localMidnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return new Date(localMidnight - offsetMinutes * 60_000);
}

/** Whole minutes, rounded up, for ETA display ("12 dəq"). Null stays null. */
export function etaMinutes(etaSec: number | null | undefined): number | null {
  if (etaSec == null) return null;
  return Math.max(1, Math.ceil(etaSec / 60));
}

/** Seconds left until `deadline`, correcting for the server clock offset (serverNow - clientNow). */
export function secondsLeft(deadline: string | Date, clockOffsetMs = 0, now: number = Date.now()): number {
  const end = deadline instanceof Date ? deadline.getTime() : Date.parse(deadline);
  return Math.max(0, Math.ceil((end - (now + clockOffsetMs)) / 1000));
}

/** ISO week key "2026-W43" (Monday-based) of the Baku-local date. Used for payout idempotency. */
export function isoWeekKey(input: string | Date | number, offsetMinutes = BAKU_OFFSET_MINUTES): string {
  const d = shifted(input, offsetMinutes);
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${pad(week)}`;
}
