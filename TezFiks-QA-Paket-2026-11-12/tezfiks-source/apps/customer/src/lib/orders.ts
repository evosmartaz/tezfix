import type { AssignmentStatus, RequestDetail, RequestStatus, RequestSummary, SlotStatus } from '@tezfiks/shared';
import { isActiveAssignment } from './tracking';

export type ToneName = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'dark';

export const ACTIVE_REQUEST_STATUSES: readonly RequestStatus[] = ['SEARCHING', 'ASSIGNED', 'IN_PROGRESS'];

export function isActiveRequest(status: RequestStatus): boolean {
  return ACTIVE_REQUEST_STATUSES.includes(status);
}

export function requestStatusTone(status: RequestStatus): ToneName {
  switch (status) {
    case 'SEARCHING':
      return 'warning';
    case 'ASSIGNED':
    case 'IN_PROGRESS':
      return 'info';
    case 'COMPLETED':
      return 'success';
    case 'CANCELLED':
      return 'neutral';
    case 'EXPIRED':
      return 'danger';
    default:
      return 'neutral';
  }
}

export function slotStatusTone(status: SlotStatus): ToneName {
  switch (status) {
    case 'OPEN':
      return 'warning';
    case 'FILLED':
      return 'info';
    case 'DONE':
      return 'success';
    case 'UNFILLED':
      return 'danger';
    default:
      return 'neutral';
  }
}

export function assignmentStatusTone(status: AssignmentStatus): ToneName {
  switch (status) {
    case 'ACCEPTED':
    case 'EN_ROUTE':
    case 'ARRIVED':
      return 'info';
    case 'PRICE_PROPOSED':
    case 'PRICE_DISPUTED':
      return 'warning';
    case 'COMPLETED':
      return 'success';
    case 'NO_SHOW':
    case 'CANCELLED_BY_PROVIDER':
      return 'danger';
    default:
      return 'neutral';
  }
}

/** A live search (or a scheduled request still waiting for providers) opens the searching screen; everything else the detail. */
export function isLiveSearch(r: Pick<RequestSummary, 'status' | 'isSearching' | 'timing'>): boolean {
  return r.status === 'SEARCHING' && r.isSearching && r.timing !== 'SCHEDULED';
}

/**
 * Spec 6.1: a request is ASSIGNED as soon as one slot is filled, and `isSearching` stays true while its open slots are
 * still being dispatched. The searching screen therefore stays open for SEARCHING, for ASSIGNED while the search for the
 * remaining handymen runs, and for EXPIRED (the "no handyman" view); every other state belongs on the detail screen.
 */
export function staysOnSearchScreen(r: Pick<RequestSummary, 'status' | 'isSearching'>): boolean {
  return r.status === 'SEARCHING' || r.status === 'EXPIRED' || (r.status === 'ASSIGNED' && r.isSearching);
}

/** ASSIGNED with open slots still dispatched (spec 6.1): some handymen found, the rest still searched for. */
export function isPartlyFilledSearch(r: Pick<RequestSummary, 'status' | 'isSearching'>): boolean {
  return r.status === 'ASSIGNED' && r.isSearching;
}

/**
 * The detail screen links to the live search while one runs: a live SEARCHING request, or an ASSIGNED one whose open
 * slots are still dispatched. A scheduled request only counts once its live ring dispatch has started (search state set).
 */
export function showsSearchLink(r: Pick<RequestSummary, 'status' | 'isSearching' | 'timing'> & { search: unknown }): boolean {
  if (isLiveSearch(r)) return true;
  return isPartlyFilledSearch(r) && (r.timing !== 'SCHEDULED' || r.search != null);
}

export function requestHref(r: Pick<RequestSummary, 'id' | 'status' | 'isSearching' | 'timing'>): string {
  return isLiveSearch(r) ? `/request/${r.id}/searching` : `/request/${r.id}`;
}

/** Request states in which a handyman can be on the way or at work (the summary alone cannot tell which one). */
export function mayHaveLiveAssignment(r: Pick<RequestSummary, 'status' | 'isSearching'>): boolean {
  return (r.status === 'ASSIGNED' || r.status === 'IN_PROGRESS') && !r.isSearching;
}

/**
 * Spec customer flow B4 → B5: once a handyman works on the request, the customer belongs on their live tracking. Returns
 * the assignment id when the request (no longer searching) has exactly one active assignment; null when there is none,
 * when several handymen work on it (the request detail is the overview) or while more handymen are still searched for.
 */
export function liveAssignmentId(r: Pick<RequestDetail, 'status' | 'isSearching' | 'assignments'>): string | null {
  if (!mayHaveLiveAssignment(r)) return null;
  const live = r.assignments.filter((a) => isActiveAssignment(a.status));
  return live.length === 1 ? live[0].id : null;
}

const BANNER_PRIORITY: Record<string, number> = { IN_PROGRESS: 0, ASSIGNED: 1, SEARCHING: 2 };

/**
 * The request shown in the home "active request" banner: an in-progress job first (the handyman is on the way or working),
 * then an assigned one, then a running search; newest first within the same status.
 */
export function pickBannerRequest(items: readonly RequestSummary[] | undefined): RequestSummary | null {
  const active = (items ?? []).filter((r) => isActiveRequest(r.status));
  if (!active.length) return null;
  return [...active].sort(
    (a, b) => (BANNER_PRIORITY[a.status] ?? 9) - (BANNER_PRIORITY[b.status] ?? 9) || Date.parse(b.createdAt) - Date.parse(a.createdAt),
  )[0];
}

/** Flattens infinite-query pages and drops duplicates (an item can move between pages while new requests arrive). */
export function mergePages<T extends { id: string }>(pages: ReadonlyArray<{ items: readonly T[] }> | undefined): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const p of pages ?? []) {
    for (const it of p.items) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      out.push(it);
    }
  }
  return out;
}

/** Guaranteed reach in Baku per H3 ring (spec 5: k=0 1.2 km ... k=5 11.4 km). */
export const RING_REACH_KM = [1.2, 2.9, 5.1, 7.1, 9.3, 11.4] as const;

export function reachKmForRing(ring: number): number {
  const i = Math.min(Math.max(0, Math.floor(ring)), RING_REACH_KM.length - 1);
  return RING_REACH_KM[i];
}

export interface CancellationSummary {
  cancelledAt: string;
  /** Whole minutes between the (latest) acceptance and the cancellation; null when no handyman had accepted. */
  minutesAfterAccept: number | null;
  /** "late" when the customer cancelled a handyman after the free-cancel window (a paid cancellation). */
  kind: 'free' | 'late';
}

/**
 * What the cancelled-order screen shows (UX-C04: one status, plus a separate free/late line). Derived from the request
 * and its assignments only; the charged amount itself is in the wallet history.
 */
export function cancellationSummary(
  r: Pick<RequestDetail, 'status' | 'cancelledAt' | 'assignments'>,
): CancellationSummary | null {
  if (r.status !== 'CANCELLED' || !r.cancelledAt) return null;
  const cancelledMs = Date.parse(r.cancelledAt);
  const accepted = r.assignments.filter((a) => Number.isFinite(Date.parse(a.acceptedAt)) && Date.parse(a.acceptedAt) <= cancelledMs);
  const latestAccept = accepted.reduce<number | null>((m, a) => Math.max(m ?? 0, Date.parse(a.acceptedAt)), null);
  // Spec 6.x terminal states: CANCELLED_FREE = either side inside the window, CANCELLED_BY_CUSTOMER = late customer cancel.
  const late = r.assignments.some((a) => a.status === 'CANCELLED_BY_CUSTOMER');
  return {
    cancelledAt: r.cancelledAt,
    minutesAfterAccept: latestAccept === null ? null : Math.max(0, Math.floor((cancelledMs - latestAccept) / 60_000)),
    kind: late ? 'late' : 'free',
  };
}
