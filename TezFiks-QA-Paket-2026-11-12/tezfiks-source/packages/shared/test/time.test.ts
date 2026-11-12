import { describe, expect, it } from 'vitest';
import { bakuDayKey, etaMinutes, formatDateTime, isoWeekKey, secondsLeft, startOfBakuDay } from '../src/time';

describe('time', () => {
  it('renders Baku local time (UTC+4)', () => {
    expect(formatDateTime('2026-10-24T14:05:00Z', 'az')).toBe('24.10.2026, 18:05');
    expect(formatDateTime('2026-10-24T22:30:00Z', 'en')).toBe('25.10.2026, 02:30');
  });
  it('computes Baku day boundaries', () => {
    expect(bakuDayKey('2026-10-24T20:00:00Z')).toBe('2026-10-25');
    expect(startOfBakuDay('2026-10-24T20:00:00Z').toISOString()).toBe('2026-10-24T20:00:00.000Z');
    expect(startOfBakuDay('2026-10-24T19:59:00Z').toISOString()).toBe('2026-10-23T20:00:00.000Z');
  });
  it('rounds ETA up to whole minutes and clamps countdowns', () => {
    expect(etaMinutes(61)).toBe(2);
    expect(etaMinutes(10)).toBe(1);
    expect(etaMinutes(null)).toBeNull();
    expect(secondsLeft('2026-10-24T10:00:30Z', 0, Date.parse('2026-10-24T10:00:00Z'))).toBe(30);
    expect(secondsLeft('2026-10-24T10:00:00Z', 0, Date.parse('2026-10-24T10:00:05Z'))).toBe(0);
    expect(secondsLeft('2026-10-24T10:00:30Z', 10_000, Date.parse('2026-10-24T10:00:00Z'))).toBe(20);
  });
  it('builds ISO week keys', () => {
    expect(isoWeekKey('2026-10-24T10:00:00Z')).toBe('2026-W43');
    expect(isoWeekKey('2027-01-01T10:00:00Z')).toBe('2026-W53');
  });
});
