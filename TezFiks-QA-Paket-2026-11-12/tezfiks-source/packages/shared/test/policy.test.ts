import { describe, expect, it } from 'vitest';
import {
  cancellationOutcome,
  customerCancelPenaltyNow,
  ringPlan,
  ringsCoveredAtStep,
  shouldUnlockContact,
  vatBreakdown,
  isContactWindowOpen,
  isLiveTracked,
  SCHEDULED_LIVE_TRACKING_LEAD_MS,
} from '../src/policy';
import { DEFAULT_SETTINGS as S } from '../src/settings';

const accepted = new Date('2026-10-24T10:00:00Z');
const freeUntil = new Date(accepted.getTime() + 300_000);
const at = (sec: number) => new Date(accepted.getTime() + sec * 1000);

describe('cancellation matrix', () => {
  it('is free for either side within 5 minutes', () => {
    const c = cancellationOutcome({ actor: 'CUSTOMER', kind: 'CANCEL', status: 'ACCEPTED', freeCancelUntil: freeUntil, feeCaptured: false, now: at(299) }, S);
    expect(c).toMatchObject({ allowed: true, status: 'CANCELLED_FREE', free: true, feeAction: 'RELEASE_HOLD', emergencyAction: 'RELEASE', customerPenalty: 0, redispatch: false });
    const p = cancellationOutcome({ actor: 'PROVIDER', kind: 'CANCEL', status: 'EN_ROUTE', freeCancelUntil: freeUntil, feeCaptured: false, now: at(10) }, S);
    expect(p).toMatchObject({ allowed: true, status: 'CANCELLED_FREE', feeAction: 'RELEASE_HOLD', emergencyAction: 'KEEP', strike: false, redispatch: true });
  });
  it('keeps the fee and adds a strike when the provider cancels late', () => {
    const p = cancellationOutcome({ actor: 'PROVIDER', kind: 'CANCEL', status: 'EN_ROUTE', freeCancelUntil: freeUntil, feeCaptured: true, now: at(301) }, S);
    expect(p).toMatchObject({ status: 'CANCELLED_BY_PROVIDER', feeAction: 'KEEP', strike: true, redispatch: true, customerPenalty: 0 });
  });
  it('charges 15 AZN and refunds plus compensates the provider when the customer cancels late', () => {
    const c = cancellationOutcome({ actor: 'CUSTOMER', kind: 'CANCEL', status: 'EN_ROUTE', freeCancelUntil: freeUntil, feeCaptured: true, now: at(400) }, S);
    expect(c).toMatchObject({ status: 'CANCELLED_BY_CUSTOMER', feeAction: 'REFUND', customerPenalty: 1500, providerCompensation: 1000, strike: false });
  });
  it('treats decline on arrival like a late customer cancel even inside the window', () => {
    const c = cancellationOutcome({ actor: 'CUSTOMER', kind: 'DECLINE_ON_ARRIVAL', status: 'ARRIVED', freeCancelUntil: freeUntil, feeCaptured: false, now: at(200) }, S);
    expect(c).toMatchObject({ status: 'DECLINED_ON_ARRIVAL', feeAction: 'RELEASE_HOLD', customerPenalty: 1500, providerCompensation: 1000 });
  });
  it('rejects actions in the wrong state', () => {
    expect(cancellationOutcome({ actor: 'CUSTOMER', kind: 'CANCEL', status: 'ARRIVED', freeCancelUntil: freeUntil, feeCaptured: false, now: at(1) }, S).allowed).toBe(false);
    expect(cancellationOutcome({ actor: 'PROVIDER', kind: 'DECLINE_ON_ARRIVAL', status: 'ARRIVED', freeCancelUntil: freeUntil, feeCaptured: false, now: at(1) }, S).allowed).toBe(false);
    expect(cancellationOutcome({ actor: 'CUSTOMER', kind: 'CANCEL', status: 'COMPLETED', freeCancelUntil: freeUntil, feeCaptured: true, now: at(1) }, S).allowed).toBe(false);
  });
  it('allows a no-show report only after noShowAfterMin', () => {
    const early = cancellationOutcome({ actor: 'CUSTOMER', kind: 'NO_SHOW', status: 'EN_ROUTE', freeCancelUntil: freeUntil, feeCaptured: true, now: at(60), acceptedAt: accepted }, S);
    expect(early.allowed).toBe(false);
    const late = cancellationOutcome({ actor: 'CUSTOMER', kind: 'NO_SHOW', status: 'EN_ROUTE', freeCancelUntil: freeUntil, feeCaptured: true, now: at(46 * 60), acceptedAt: accepted }, S);
    expect(late).toMatchObject({ allowed: true, status: 'NO_SHOW', strike: true, redispatch: true, feeAction: 'KEEP' });
  });
  it('charges nothing on guarantee re-fix jobs', () => {
    const c = cancellationOutcome({ actor: 'CUSTOMER', kind: 'CANCEL', status: 'EN_ROUTE', freeCancelUntil: freeUntil, feeCaptured: false, now: at(900), isGuaranteeFix: true }, S);
    expect(c).toMatchObject({ customerPenalty: 0, providerCompensation: 0, feeAction: 'NONE' });
  });
  it('previews the customer penalty', () => {
    expect(customerCancelPenaltyNow({ status: 'ACCEPTED', freeCancelUntil: freeUntil }, S, at(10))).toBe(0);
    expect(customerCancelPenaltyNow({ status: 'EN_ROUTE', freeCancelUntil: freeUntil }, S, at(301))).toBe(1500);
    expect(customerCancelPenaltyNow({ status: 'ARRIVED', freeCancelUntil: freeUntil }, S, at(10))).toBe(1500);
  });
});

describe('ring plan', () => {
  it('expands k0..k4 then a wide k5 step for normal requests', () => {
    const plan = ringPlan('NOW', S);
    expect(plan.map((s) => s.ring)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(plan.map((s) => s.atSec)).toEqual([0, 30, 60, 90, 120, 150]);
    expect(plan[5]!.wide).toBe(true);
  });
  it('starts emergencies at k1 with faster steps', () => {
    const plan = ringPlan('EMERGENCY', S);
    expect(plan.map((s) => s.ring)).toEqual([1, 2, 3, 4, 5]);
    expect(plan.map((s) => s.atSec)).toEqual([0, 20, 40, 60, 80]);
    expect(ringsCoveredAtStep('EMERGENCY', 0)).toEqual([0, 1]);
    expect(ringsCoveredAtStep('NOW', 2)).toEqual([0, 1, 2]);
  });
});

describe('contact unlock', () => {
  it('unlocks at ETA <= 5 min en route or on arrival, and never relocks', () => {
    expect(shouldUnlockContact({ status: 'EN_ROUTE', etaSec: 301, contactUnlockedAt: null }, S)).toBe(false);
    expect(shouldUnlockContact({ status: 'EN_ROUTE', etaSec: 300, contactUnlockedAt: null }, S)).toBe(true);
    expect(shouldUnlockContact({ status: 'ACCEPTED', etaSec: 100, contactUnlockedAt: null }, S)).toBe(false);
    expect(shouldUnlockContact({ status: 'ARRIVED', etaSec: null, contactUnlockedAt: null }, S)).toBe(true);
    expect(shouldUnlockContact({ status: 'EN_ROUTE', etaSec: 900, contactUnlockedAt: '2026-10-24T10:00:00Z' }, S)).toBe(true);
  });
  it('tracks the handyman live from acceptance for NOW/EMERGENCY jobs, and from an hour before a scheduled job (founder decision 2026-10-26)', () => {
    const now = accepted.getTime();
    expect(isLiveTracked({ status: 'ACCEPTED', timing: 'NOW', scheduledAt: null }, now)).toBe(true);
    expect(isLiveTracked({ status: 'ACCEPTED', timing: 'EMERGENCY', scheduledAt: null }, now)).toBe(true);
    expect(isLiveTracked({ status: 'EN_ROUTE', timing: 'SCHEDULED', scheduledAt: at(5 * 3600) }, now)).toBe(true);
    expect(isLiveTracked({ status: 'ACCEPTED', timing: 'SCHEDULED', scheduledAt: at(3600) }, now)).toBe(true);
    expect(isLiveTracked({ status: 'ACCEPTED', timing: 'SCHEDULED', scheduledAt: at(3601) }, now)).toBe(false);
    expect(isLiveTracked({ status: 'ACCEPTED', timing: 'SCHEDULED', scheduledAt: null }, now)).toBe(false);
    for (const status of ['ARRIVED', 'PRICE_PROPOSED', 'COMPLETED', 'CANCELLED_FREE'] as const) {
      expect(isLiveTracked({ status, timing: 'NOW', scheduledAt: null }, now)).toBe(false);
    }
    expect(SCHEDULED_LIVE_TRACKING_LEAD_MS).toBe(3_600_000);
  });
  it('closes the contact window 2 hours after the job ended', () => {
    const ended = '2026-10-24T10:00:00Z';
    expect(isContactWindowOpen({ contactUnlockedAt: ended, endedAt: ended }, S, new Date('2026-10-24T11:59:00Z'))).toBe(true);
    expect(isContactWindowOpen({ contactUnlockedAt: ended, endedAt: ended }, S, new Date('2026-10-24T12:01:00Z'))).toBe(false);
    expect(isContactWindowOpen({ contactUnlockedAt: null, endedAt: null }, S, new Date())).toBe(false);
  });
});

describe('vat', () => {
  it('adds 18% VAT only for VAT payers', () => {
    expect(vatBreakdown(15000, 18, true)).toEqual({ subtotal: 15000, vatRatePercent: 18, vatAmount: 2700, total: 17700 });
    expect(vatBreakdown(15000, 18, false)).toEqual({ subtotal: 15000, vatRatePercent: 0, vatAmount: 0, total: 15000 });
  });
});
