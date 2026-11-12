import {
  FALLBACK_TIMING_CONFIG,
  availableTimings,
  bakuParts,
  clampSlots,
  coerceTiming,
  defaultScheduledAt,
  emergencyFeeFor,
  emergencyShortfall,
  fromBakuParts,
  roundUpToStep,
  scheduleBounds,
  validateScheduledAt,
  withBakuDate,
  withBakuTime,
} from '../src/lib/timing';

const cfg = { ...FALLBACK_TIMING_CONFIG, scheduledMinLeadMin: 30, scheduledMaxLeadDays: 30 };
const NOW = new Date('2026-10-25T10:07:30.000Z'); // 14:07:30 in Baku

describe('timing rules (İndi / Planla / Təcili)', () => {
  it('fallback config equals the spec defaults', () => {
    expect(FALLBACK_TIMING_CONFIG).toEqual({ emergencyFeePerSlot: 500, maxSlots: 10, maxPhotos: 5, scheduledMinLeadMin: 30, scheduledMaxLeadDays: 30 });
  });

  it('offers Təcili only for categories that allow emergencies', () => {
    expect(availableTimings({ emergencyAllowed: true })).toEqual(['NOW', 'SCHEDULED', 'EMERGENCY']);
    expect(availableTimings({ emergencyAllowed: false })).toEqual(['NOW', 'SCHEDULED']);
    expect(availableTimings(null)).toEqual(['NOW', 'SCHEDULED']);
    expect(coerceTiming('EMERGENCY', { emergencyAllowed: false })).toBe('NOW');
    expect(coerceTiming('EMERGENCY', { emergencyAllowed: true })).toBe('EMERGENCY');
    expect(coerceTiming('SCHEDULED', null)).toBe('SCHEDULED');
  });

  it('scheduled bounds come from the public config (min lead, max lead days)', () => {
    const { min, max } = scheduleBounds(NOW, cfg);
    expect(min.toISOString()).toBe('2026-10-25T10:37:30.000Z');
    expect(max.toISOString()).toBe('2026-11-24T10:07:30.000Z');
  });

  it('validates the boundaries exactly like the API', () => {
    const { min, max } = scheduleBounds(NOW, cfg);
    expect(validateScheduledAt(min, NOW, cfg)).toBeNull();
    expect(validateScheduledAt(new Date(min.getTime() - 1), NOW, cfg)).toBe('SCHEDULE_TOO_SOON');
    expect(validateScheduledAt(max, NOW, cfg)).toBeNull();
    expect(validateScheduledAt(new Date(max.getTime() + 1), NOW, cfg)).toBe('SCHEDULE_TOO_FAR');
    expect(validateScheduledAt(null, NOW, cfg)).toBe('SCHEDULE_REQUIRED');
    expect(validateScheduledAt(new Date(NaN), NOW, cfg)).toBe('SCHEDULE_REQUIRED');
  });

  it('suggests max(min lead, 1 h) ahead on a 5-minute grid, never past the maximum', () => {
    expect(defaultScheduledAt(NOW, cfg).toISOString()).toBe('2026-10-25T11:10:00.000Z');
    expect(defaultScheduledAt(NOW, { scheduledMinLeadMin: 120, scheduledMaxLeadDays: 30 }).toISOString()).toBe('2026-10-25T12:10:00.000Z');
    // Demo mode: 2 minutes minimum lead still suggests one hour ahead.
    expect(defaultScheduledAt(NOW, { scheduledMinLeadMin: 2, scheduledMaxLeadDays: 30 }).toISOString()).toBe('2026-10-25T11:10:00.000Z');
    const tight = { scheduledMinLeadMin: 0, scheduledMaxLeadDays: 0 };
    expect(defaultScheduledAt(NOW, tight).getTime()).toBe(scheduleBounds(NOW, tight).max.getTime());
    expect(validateScheduledAt(defaultScheduledAt(NOW, cfg), NOW, cfg)).toBeNull();
    expect(roundUpToStep(new Date('2026-10-25T10:10:00.000Z')).toISOString()).toBe('2026-10-25T10:10:00.000Z');
  });

  it('emergency fee: 5 AZN per handyman, and the wallet shortfall', () => {
    expect(emergencyFeeFor('EMERGENCY', 3, cfg)).toBe(1500);
    expect(emergencyFeeFor('NOW', 3, cfg)).toBe(0);
    expect(emergencyFeeFor('SCHEDULED', 3, cfg)).toBe(0);
    expect(emergencyShortfall(1000, 1500)).toBe(500);
    expect(emergencyShortfall(1500, 1500)).toBe(0);
    expect(emergencyShortfall(-200, 500)).toBe(700);
    expect(emergencyShortfall(null, 500)).toBe(500);
    expect(emergencyShortfall(0, 0)).toBe(0);
  });

  it('clamps the handymen stepper to 1..maxSlots', () => {
    expect(clampSlots(0, 10)).toBe(1);
    expect(clampSlots(11, 10)).toBe(10);
    expect(clampSlots(3.7, 10)).toBe(3);
    expect(clampSlots(Number.NaN, 10)).toBe(1);
    expect(clampSlots(5, 0)).toBe(1);
  });
});

describe('Baku wall-clock date-time picking', () => {
  it('reads and builds Baku (UTC+4) wall-clock parts', () => {
    expect(bakuParts(NOW)).toEqual({ year: 2026, month: 10, day: 25, hour: 14, minute: 7 });
    expect(fromBakuParts({ year: 2026, month: 12, day: 31, hour: 23, minute: 30 }).toISOString()).toBe('2026-12-31T19:30:00.000Z');
    // Baku midnight is 20:00 UTC the previous day.
    expect(fromBakuParts({ year: 2027, month: 1, day: 1, hour: 0, minute: 0 }).toISOString()).toBe('2026-12-31T20:00:00.000Z');
  });

  it('the date dialog changes the day and keeps the Baku time of day', () => {
    const base = new Date('2026-10-25T11:10:00.000Z'); // 15:10 Baku
    const picked = new Date('2026-10-28T20:30:00.000Z'); // 00:30 on 29 Oct in Baku
    expect(withBakuDate(base, picked).toISOString()).toBe('2026-10-29T11:10:00.000Z');
  });

  it('the time dialog changes the hour/minute and keeps the Baku day', () => {
    const base = new Date('2026-10-25T21:00:00.000Z'); // 01:00 on 26 Oct in Baku
    const picked = new Date('2026-10-25T05:45:00.000Z'); // 09:45 Baku
    expect(withBakuTime(base, picked).toISOString()).toBe('2026-10-26T05:45:00.000Z');
  });
});
