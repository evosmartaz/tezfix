import { BAKU_OFFSET_MINUTES, type Category, type RequestTiming } from '@tezfiks/shared';

/** The subset of GET /config/public the request form needs. */
export interface TimingConfig {
  emergencyFeePerSlot: number;
  maxSlots: number;
  maxPhotos: number;
  scheduledMinLeadMin: number;
  scheduledMaxLeadDays: number;
}

/** Spec defaults (DEFAULT_SETTINGS) used until /config/public has loaded. */
export const FALLBACK_TIMING_CONFIG: TimingConfig = {
  emergencyFeePerSlot: 500,
  maxSlots: 10,
  maxPhotos: 5,
  scheduledMinLeadMin: 30,
  scheduledMaxLeadDays: 30,
};

const MIN = 60_000;
const DAY = 86_400_000;
/** Scheduled times are offered on a 5-minute grid. */
export const SCHEDULE_STEP_MIN = 5;
/** Default suggestion: at least one hour ahead, or the minimum lead when it is longer. */
export const DEFAULT_SCHEDULE_AHEAD_MIN = 60;

/** İndi / Planla / Təcili; emergency only for categories that allow it (spec 4.2). */
export function availableTimings(category: Pick<Category, 'emergencyAllowed'> | null | undefined): RequestTiming[] {
  return category?.emergencyAllowed ? ['NOW', 'SCHEDULED', 'EMERGENCY'] : ['NOW', 'SCHEDULED'];
}

/** Falls back to NOW when the selected timing is not available for the category. */
export function coerceTiming(timing: RequestTiming, category: Pick<Category, 'emergencyAllowed'> | null | undefined): RequestTiming {
  return availableTimings(category).includes(timing) ? timing : 'NOW';
}

export function scheduleBounds(now: Date, cfg: Pick<TimingConfig, 'scheduledMinLeadMin' | 'scheduledMaxLeadDays'>): { min: Date; max: Date } {
  return {
    min: new Date(now.getTime() + cfg.scheduledMinLeadMin * MIN),
    max: new Date(now.getTime() + cfg.scheduledMaxLeadDays * DAY),
  };
}

/** Rounds up to the next multiple of `stepMin` minutes (seconds dropped). */
export function roundUpToStep(at: Date, stepMin = SCHEDULE_STEP_MIN): Date {
  const step = stepMin * MIN;
  return new Date(Math.ceil(at.getTime() / step) * step);
}

/** First suggestion for "Planla": max(min lead, 1 h) ahead, on the 5-minute grid, never past the maximum. */
export function defaultScheduledAt(now: Date, cfg: Pick<TimingConfig, 'scheduledMinLeadMin' | 'scheduledMaxLeadDays'>): Date {
  const { max } = scheduleBounds(now, cfg);
  const ahead = Math.max(cfg.scheduledMinLeadMin, DEFAULT_SCHEDULE_AHEAD_MIN);
  const at = roundUpToStep(new Date(now.getTime() + ahead * MIN));
  return at.getTime() > max.getTime() ? max : at;
}

export type ScheduleError = 'SCHEDULE_TOO_SOON' | 'SCHEDULE_TOO_FAR';

/** Same bounds as the API (spec 5: scheduledAt ≥ now + min lead and ≤ now + max lead days). */
export function validateScheduledAt(
  at: Date | null | undefined,
  now: Date,
  cfg: Pick<TimingConfig, 'scheduledMinLeadMin' | 'scheduledMaxLeadDays'>,
): ScheduleError | 'SCHEDULE_REQUIRED' | null {
  if (!at || Number.isNaN(at.getTime())) return 'SCHEDULE_REQUIRED';
  const { min, max } = scheduleBounds(now, cfg);
  if (at.getTime() < min.getTime()) return 'SCHEDULE_TOO_SOON';
  if (at.getTime() > max.getTime()) return 'SCHEDULE_TOO_FAR';
  return null;
}

/** Customer hold for an emergency request: one emergencyFeePerSlot per requested handyman. */
export function emergencyFeeFor(timing: RequestTiming, slots: number, cfg: Pick<TimingConfig, 'emergencyFeePerSlot'>): number {
  return timing === 'EMERGENCY' ? cfg.emergencyFeePerSlot * Math.max(1, Math.floor(slots)) : 0;
}

/** How much the wallet is short of the emergency hold (0 when it is enough). */
export function emergencyShortfall(available: number | null | undefined, fee: number): number {
  if (fee <= 0) return 0;
  return Math.max(0, fee - (available ?? 0));
}

/** Stepper bounds for "number of handymen". */
export function clampSlots(n: number, maxSlots: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(Math.max(1, Math.floor(n)), Math.max(1, maxSlots));
}

// ---------------------------------------------------------------------------
// Baku wall-clock helpers for the date-time picker (spec: business time is Asia/Baku, UTC+4, no DST).
// ---------------------------------------------------------------------------

export interface BakuParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
}

export function bakuParts(at: Date, offsetMinutes = BAKU_OFFSET_MINUTES): BakuParts {
  const d = new Date(at.getTime() + offsetMinutes * MIN);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes() };
}

export function fromBakuParts(p: BakuParts, offsetMinutes = BAKU_OFFSET_MINUTES): Date {
  return new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - offsetMinutes * MIN);
}

/** Keeps the Baku time of day of `base` and takes the Baku calendar day of `picked` (date dialog result). */
export function withBakuDate(base: Date, picked: Date): Date {
  const b = bakuParts(base);
  const p = bakuParts(picked);
  return fromBakuParts({ ...b, year: p.year, month: p.month, day: p.day });
}

/** Keeps the Baku calendar day of `base` and takes the Baku hour/minute of `picked` (time dialog result). */
export function withBakuTime(base: Date, picked: Date): Date {
  const b = bakuParts(base);
  const p = bakuParts(picked);
  return fromBakuParts({ ...b, hour: p.hour, minute: p.minute });
}
