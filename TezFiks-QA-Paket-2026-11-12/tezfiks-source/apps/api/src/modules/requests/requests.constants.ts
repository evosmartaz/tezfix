/** Job names and deterministic job ids used by lane B1 (dispatch, offers, fee window). */
export const JOB = {
  dispatchStep: 'dispatch.step',
  dispatchEnd: 'dispatch.end',
  offerExpire: 'offer.expire',
  scheduledLive: 'dispatch.scheduledLive',
  scheduledUnfilled: 'dispatch.scheduledUnfilled',
  scheduledReminder: 'dispatch.scheduledReminder',
  feeWindowClose: 'assignment.feeWindowClose',
} as const;

export const jobId = {
  dispatchStep: (requestId: string) => `dispatch-step-${requestId}`,
  dispatchEnd: (requestId: string) => `dispatch-end-${requestId}`,
  offerExpire: (offerId: string) => `offer-expire-${offerId}`,
  scheduledLive: (requestId: string) => `sched-live-${requestId}`,
  scheduledUnfilled: (requestId: string) => `sched-unfilled-${requestId}`,
  scheduledReminder: (requestId: string, kind: '24h' | '1h') => `sched-remind-${kind}-${requestId}`,
  feeWindowClose: (assignmentId: string) => `fee-window-${assignmentId}`,
};

export const RECONCILER_TASK = {
  dispatch: 'dispatch.repair',
  fees: 'fees.repair',
} as const;

/** Request statuses in which the request is still open. */
export const OPEN_REQUEST_STATUSES = ['SEARCHING', 'ASSIGNED', 'IN_PROGRESS'] as const;
export const TERMINAL_REQUEST_STATUSES = ['COMPLETED', 'CANCELLED', 'EXPIRED'] as const;

/** A scheduled job blocks another scheduled job of the same provider within this window (spec 5: ±2 h). */
export const SCHEDULE_CONFLICT_MS = 2 * 60 * 60_000;

/** Offer description preview length (contract: first 140 characters). */
export const DESCRIPTION_SHORT_LEN = 140;

/** Offer coordinates are rounded to 3 decimals (~100 m). */
export function roundCoord(v: number): number {
  return Math.round(v * 1000) / 1000;
}

export function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === 'P2002';
}
