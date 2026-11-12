import type { AssignmentStatus, RequestTiming } from './enums';
import type { PlatformSettings } from './settings';

// ---------------------------------------------------------------------------
// Cancellation matrix (spec 4.1). Pure: the API applies the ledger effects.
// ---------------------------------------------------------------------------

export type CancelActor = 'CUSTOMER' | 'PROVIDER';
export type CancelKind = 'CANCEL' | 'DECLINE_ON_ARRIVAL' | 'NO_SHOW';

export interface CancellationOutcome {
  allowed: boolean;
  /** Resulting assignment status. */
  status: AssignmentStatus | null;
  /** True when inside the free window. */
  free: boolean;
  /** What happens to the provider's request fee (an active hold, or an already captured fee). */
  feeAction: 'RELEASE_HOLD' | 'KEEP' | 'REFUND' | 'NONE';
  /** What happens to the slot's emergency fee (customer money). */
  emergencyAction: 'RELEASE' | 'KEEP' | 'NONE';
  customerPenalty: number;
  providerCompensation: number;
  strike: boolean;
  /** Re-open the slot and dispatch again. */
  redispatch: boolean;
}

const DENY: CancellationOutcome = {
  allowed: false,
  status: null,
  free: false,
  feeAction: 'NONE',
  emergencyAction: 'NONE',
  customerPenalty: 0,
  providerCompensation: 0,
  strike: false,
  redispatch: false,
};

export interface CancellationInput {
  actor: CancelActor;
  kind: CancelKind;
  status: AssignmentStatus;
  freeCancelUntil: Date | string;
  /** Whether the provider fee was already captured (free window closed or job completed). */
  feeCaptured: boolean;
  now: Date;
  /** Assignment created by a guarantee re-fix: no fees and no penalties. */
  isGuaranteeFix?: boolean;
  /** For NO_SHOW: when the provider accepted. */
  acceptedAt?: Date | string;
}

/**
 * Decides the effect of a cancellation, decline on arrival, or no-show report.
 * feeAction RELEASE_HOLD vs REFUND is decided by `feeCaptured`: a captured fee is refunded with a reversing entry.
 */
export function cancellationOutcome(input: CancellationInput, s: PlatformSettings): CancellationOutcome {
  const { actor, kind, status, now } = input;
  const freeUntil = new Date(input.freeCancelUntil).getTime();
  const inWindow = now.getTime() <= freeUntil;
  const noFees = input.isGuaranteeFix === true;
  const giveBack: CancellationOutcome['feeAction'] = noFees ? 'NONE' : input.feeCaptured ? 'REFUND' : 'RELEASE_HOLD';

  if (kind === 'NO_SHOW') {
    if (actor !== 'CUSTOMER' || (status !== 'ACCEPTED' && status !== 'EN_ROUTE')) return DENY;
    const since = new Date(input.acceptedAt ?? input.freeCancelUntil).getTime();
    if (now.getTime() < since + s.noShowAfterMin * 60_000) return DENY;
    return {
      allowed: true,
      status: 'NO_SHOW',
      free: false,
      feeAction: noFees ? 'NONE' : 'KEEP',
      emergencyAction: noFees ? 'NONE' : 'KEEP',
      customerPenalty: 0,
      providerCompensation: 0,
      strike: true,
      redispatch: true,
    };
  }

  if (kind === 'DECLINE_ON_ARRIVAL') {
    if (actor !== 'CUSTOMER' || status !== 'ARRIVED') return DENY;
    return {
      allowed: true,
      status: 'DECLINED_ON_ARRIVAL',
      free: false,
      feeAction: giveBack,
      emergencyAction: noFees ? 'NONE' : 'KEEP',
      customerPenalty: noFees ? 0 : s.cancelPenalty,
      providerCompensation: noFees ? 0 : s.penaltyCompensation,
      strike: false,
      redispatch: false,
    };
  }

  // kind === 'CANCEL'
  if (status !== 'ACCEPTED' && status !== 'EN_ROUTE') return DENY;
  if (inWindow) {
    return {
      allowed: true,
      status: 'CANCELLED_FREE',
      free: true,
      feeAction: giveBack,
      emergencyAction: noFees ? 'NONE' : actor === 'CUSTOMER' ? 'RELEASE' : 'KEEP',
      customerPenalty: 0,
      providerCompensation: 0,
      strike: false,
      redispatch: actor === 'PROVIDER',
    };
  }
  if (actor === 'PROVIDER') {
    return {
      allowed: true,
      status: 'CANCELLED_BY_PROVIDER',
      free: false,
      feeAction: noFees ? 'NONE' : 'KEEP',
      emergencyAction: noFees ? 'NONE' : 'KEEP',
      customerPenalty: 0,
      providerCompensation: 0,
      strike: true,
      redispatch: true,
    };
  }
  return {
    allowed: true,
    status: 'CANCELLED_BY_CUSTOMER',
    free: false,
    feeAction: giveBack,
    emergencyAction: noFees ? 'NONE' : 'KEEP',
    customerPenalty: noFees ? 0 : s.cancelPenalty,
    providerCompensation: noFees ? 0 : s.penaltyCompensation,
    strike: false,
    redispatch: false,
  };
}

/** Penalty the customer would pay if they cancelled (or declined) this assignment right now. For UI warnings. */
export function customerCancelPenaltyNow(
  a: { status: AssignmentStatus; freeCancelUntil: Date | string; isGuaranteeFix?: boolean },
  s: PlatformSettings,
  now: Date,
): number {
  const kind: CancelKind = a.status === 'ARRIVED' ? 'DECLINE_ON_ARRIVAL' : 'CANCEL';
  const out = cancellationOutcome(
    {
      actor: 'CUSTOMER',
      kind,
      status: a.status,
      freeCancelUntil: a.freeCancelUntil,
      feeCaptured: false,
      now,
      isGuaranteeFix: a.isGuaranteeFix,
    },
    s,
  );
  return out.allowed ? out.customerPenalty : 0;
}

// ---------------------------------------------------------------------------
// Ring expansion plan (spec 5)
// ---------------------------------------------------------------------------

export interface RingStep {
  step: number;
  /** Ring index (k) newly offered in this step. The wide step offers ring 5 plus service-area matches. */
  ring: number;
  wide: boolean;
  /** Seconds after search start at which this step runs (before the min-candidates fast-forward). */
  atSec: number;
}

export function ringPlan(timing: RequestTiming, s: PlatformSettings): RingStep[] {
  const emergency = timing === 'EMERGENCY';
  const stepSec = emergency ? s.emergencyRingStepSec : s.ringStepSec;
  const rings = emergency ? [1, 2, 3, 4] : [0, 1, 2, 3, 4];
  const steps: RingStep[] = rings.map((ring, i) => ({ step: i, ring, wide: false, atSec: i * stepSec }));
  steps.push({ step: steps.length, ring: 5, wide: true, atSec: steps.length * stepSec });
  return steps;
}

/** Minimum delay between steps when the min-candidates rule fast-forwards. */
export const RING_FAST_FORWARD_SEC = 3;

/** Emergency searches start at k=1, so step 0 covers the whole k<=1 disk (center cell included). */
export function ringsCoveredAtStep(timing: RequestTiming, step: number): number[] {
  const plan = ringPlan(timing, { ringStepSec: 1, emergencyRingStepSec: 1 } as PlatformSettings);
  const first = plan[0]!.ring;
  const current = plan[Math.min(step, plan.length - 1)]!.ring;
  const out: number[] = [];
  for (let k = first === 1 ? 0 : first; k <= current; k++) out.push(k);
  return out;
}

// ---------------------------------------------------------------------------
// Contact unlock (spec 4.4)
// ---------------------------------------------------------------------------

/** Unlock once the provider is EN_ROUTE with ETA <= contactUnlockEtaSec, or has arrived (or later). Never relocks. */
export function shouldUnlockContact(
  a: { status: AssignmentStatus; etaSec: number | null; contactUnlockedAt: Date | string | null },
  s: PlatformSettings,
): boolean {
  if (a.contactUnlockedAt) return true;
  if (a.status === 'ARRIVED' || a.status === 'PRICE_PROPOSED' || a.status === 'PRICE_DISPUTED' || a.status === 'COMPLETED') {
    return true;
  }
  return a.status === 'EN_ROUTE' && a.etaSec != null && a.etaSec <= s.contactUnlockEtaSec;
}

/** How long before a scheduled job's time its accepted handyman starts being tracked live. */
export const SCHEDULED_LIVE_TRACKING_LEAD_MS = 60 * 60_000;

/**
 * Whether the handyman's live position is tracked for a job: always while EN_ROUTE, and already from acceptance for NOW and
 * EMERGENCY jobs (or from an hour before a scheduled job's time). The customer then sees the handyman on the map with a live
 * ETA, and the contact unlocks from that live ETA whether or not they pressed "Yola çıxdım" (founder decision 2026-10-26).
 */
export function isLiveTracked(
  a: { status: AssignmentStatus; timing: RequestTiming; scheduledAt: Date | string | null },
  nowMs: number,
): boolean {
  if (a.status === 'EN_ROUTE') return true;
  if (a.status !== 'ACCEPTED') return false;
  if (a.timing !== 'SCHEDULED') return true;
  return a.scheduledAt != null && new Date(a.scheduledAt).getTime() - nowMs <= SCHEDULED_LIVE_TRACKING_LEAD_MS;
}

/** Phone/chat stay visible from unlock until chatOpenAfterTerminalMin after the assignment ended. */
export function isContactWindowOpen(
  a: { contactUnlockedAt: Date | string | null; endedAt: Date | string | null },
  s: PlatformSettings,
  now: Date,
): boolean {
  if (!a.contactUnlockedAt) return false;
  if (!a.endedAt) return true;
  return now.getTime() <= new Date(a.endedAt).getTime() + s.chatOpenAfterTerminalMin * 60_000;
}

// ---------------------------------------------------------------------------
// Money helpers
// ---------------------------------------------------------------------------

export function emergencyFeeTotal(timing: RequestTiming, slots: number, s: PlatformSettings): number {
  return timing === 'EMERGENCY' ? s.emergencyFeePerSlot * slots : 0;
}

export function b2bQuoteFee(workers: number, days: number, s: PlatformSettings): number {
  return s.b2bFeePerWorkerDay * workers * days;
}

/** VAT split for invoices. Integers in qəpik; VAT rounded half-up. */
export function vatBreakdown(subtotal: number, ratePercent: number, vatPayer: boolean) {
  const vat = vatPayer ? Math.round((subtotal * ratePercent) / 100) : 0;
  return { subtotal, vatRatePercent: vatPayer ? ratePercent : 0, vatAmount: vat, total: subtotal + vat };
}

// ---------------------------------------------------------------------------
// Allowed actions per assignment status (spec 6.3)
// ---------------------------------------------------------------------------

export const PROVIDER_ACTIONS = {
  enRoute: ['ACCEPTED'],
  arrived: ['ACCEPTED', 'EN_ROUTE'],
  price: ['ARRIVED'],
  cancel: ['ACCEPTED', 'EN_ROUTE'],
} as const satisfies Record<string, readonly AssignmentStatus[]>;

export const CUSTOMER_ACTIONS = {
  cancel: ['ACCEPTED', 'EN_ROUTE'],
  declineOnArrival: ['ARRIVED'],
  reportNoShow: ['ACCEPTED', 'EN_ROUTE'],
  confirmPrice: ['PRICE_PROPOSED'],
  disputePrice: ['PRICE_PROPOSED'],
} as const satisfies Record<string, readonly AssignmentStatus[]>;

export function canDo<T extends Record<string, readonly AssignmentStatus[]>>(
  table: T,
  action: keyof T,
  status: AssignmentStatus,
): boolean {
  return (table[action] as readonly AssignmentStatus[]).includes(status);
}
