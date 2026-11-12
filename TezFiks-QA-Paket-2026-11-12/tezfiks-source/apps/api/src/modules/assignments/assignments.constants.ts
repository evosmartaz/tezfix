import type { AssignmentStatus } from '@tezfiks/shared';

/** Job names and deterministic job ids of lane B3 (assignment lifecycle). */
export const B3_JOB = {
  autoComplete: 'assignment.autoComplete',
} as const;

export const b3JobId = {
  autoComplete: (assignmentId: string) => `assignment-autocomplete-${assignmentId}`,
};

export const B3_RECONCILER_TASK = {
  /** Overdue auto-completions, succeeded card/tip intents not applied to their assignment. */
  assignments: 'assignments.repair',
  /** Running jobs of BLOCKED handymen / companies / users that the block listeners missed. */
  blockedProviders: 'assignments.blockedProviders',
} as const;

/** The pro is still working on the job (spec 6.3). */
export const ACTIVE_STATUSES: readonly AssignmentStatus[] = ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'PRICE_PROPOSED', 'PRICE_DISPUTED'];

export const TERMINAL_STATUSES: readonly AssignmentStatus[] = [
  'COMPLETED',
  'CANCELLED_FREE',
  'CANCELLED_BY_PROVIDER',
  'CANCELLED_BY_CUSTOMER',
  'DECLINED_ON_ARRIVAL',
  'NO_SHOW',
];

/** Assignments an admin block cancels and re-dispatches (work not done yet). */
export const BLOCK_CANCELLABLE: readonly AssignmentStatus[] = ['ACCEPTED', 'EN_ROUTE', 'ARRIVED'];

/** Re-route at most this often while en route. */
export const REROUTE_MIN_INTERVAL_MS = 120_000;
/** Re-route when the pro is further than this from the stored route. */
export const OFF_ROUTE_REROUTE_M = 150;
/** Fallback speed (spec 12: 25 km/h) used to price the off-route detour into the ETA. */
export const FALLBACK_SPEED_MPS = 25_000 / 3600;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(v: string | undefined | null): v is string {
  return !!v && UUID_RE.test(v);
}

/** "Elvin Məmmədov" (first + last, trimmed). */
export function fullName(first: string | null | undefined, last: string | null | undefined): string {
  return [first, last].filter((v) => !!v && v.trim()).join(' ').trim();
}

/** "Nizami T." (customer as shown to providers). */
export function shortName(first: string | null | undefined, last: string | null | undefined): string {
  const l = (last ?? '').trim();
  return [first?.trim() ?? '', l ? `${l.charAt(0).toLocaleUpperCase('az')}.` : ''].filter(Boolean).join(' ');
}
