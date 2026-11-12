import {
  ACTIVE_ASSIGNMENT_STATUSES,
  DEFAULT_SETTINGS,
  decodePolyline,
  etaMinutes,
  formatTime,
  secondsLeft,
  type AssignmentLocation,
  type AssignmentStatus,
  type CustomerAssignment,
} from '@tezfiks/shared';

/** What the tracking screen shows for an assignment (board 02 B5 → C1 → C2). */
export type TrackingPhase = 'accepted' | 'enRoute' | 'arrived' | 'price' | 'disputed' | 'completed' | 'cancelled';

export function trackingPhase(status: AssignmentStatus): TrackingPhase {
  switch (status) {
    case 'ACCEPTED':
      return 'accepted';
    case 'EN_ROUTE':
      return 'enRoute';
    case 'ARRIVED':
      return 'arrived';
    case 'PRICE_PROPOSED':
      return 'price';
    case 'PRICE_DISPUTED':
      return 'disputed';
    case 'COMPLETED':
      return 'completed';
    default:
      return 'cancelled';
  }
}

export function isActiveAssignment(status: AssignmentStatus): boolean {
  return (ACTIVE_ASSIGNMENT_STATUSES as readonly string[]).includes(status);
}

export function assignmentHref(a: Pick<CustomerAssignment, 'id'>): string {
  return `/assignment/${a.id}`;
}

export interface DeclineSplit {
  /** What the customer is charged (the server's declinePenalty). */
  amount: number;
  /** The handyman's trip compensation. */
  comp: number;
  /** The platform's share. */
  fee: number;
}

/**
 * Decline on arrival (spec: 15 AZN = 10 AZN to the handyman + 5 AZN to the platform). `amount` is the server's
 * declinePenalty for this assignment; the handyman's share is the platform setting penaltyCompensation (from
 * GET /config/public when it carries it, DEFAULT_SETTINGS otherwise), never more than the amount.
 */
export function declineSplit(amount: number, compensation?: number | null): DeclineSplit {
  const total = Math.max(0, Math.trunc(Number.isFinite(amount) ? amount : 0));
  const base = typeof compensation === 'number' && Number.isFinite(compensation) && compensation >= 0 ? Math.trunc(compensation) : DEFAULT_SETTINGS.penaltyCompensation;
  const comp = Math.min(base, total);
  return { amount: total, comp, fee: total - comp };
}

/** penaltyCompensation from the public config, when the server sends it (not part of the contract yet). */
export function penaltyCompensationOf(config: unknown): number | null {
  const v = (config as { penaltyCompensation?: unknown } | null | undefined)?.penaltyCompensation;
  return typeof v === 'number' ? v : null;
}

/**
 * Applies a live `assignment:location` delta to the cached assignment. Out-of-order pings (older than the location
 * already shown) are ignored; a ping never changes the status or unlocks the contact (the server sends
 * `assignment:contact` / `assignment:updated` for that, and the screen refetches).
 */
export function applyLocation(a: CustomerAssignment, p: AssignmentLocation): CustomerAssignment {
  if (p.assignmentId !== a.id) return a;
  if (a.location && Date.parse(a.location.at) > Date.parse(p.at)) return a;
  return {
    ...a,
    location: { lat: p.lat, lng: p.lng, heading: p.heading, at: p.at },
    etaSec: p.etaSec ?? a.etaSec,
    distanceM: p.distanceM ?? a.distanceM,
  };
}

/** Whole minutes for "12 dəq məsafədə" (rounded up, at least 1); null without an ETA. */
export function etaLabelMinutes(etaSec: number | null | undefined): number | null {
  return etaMinutes(etaSec);
}

export interface MapPoint {
  latitude: number;
  longitude: number;
}

/** The stored route polyline as map coordinates (empty when there is no route or it cannot be decoded). */
export function routeCoordinates(route: CustomerAssignment['route']): MapPoint[] {
  if (!route?.polyline) return [];
  try {
    return decodePolyline(route.polyline).map((p) => ({ latitude: p.lat, longitude: p.lng }));
  } catch {
    return [];
  }
}

/**
 * The part of the route still ahead of the handyman: from the route point closest to the live position to the end,
 * starting at the live position itself. Without a live position the whole route is returned.
 */
export function remainingRoute(points: MapPoint[], live: MapPoint | null): MapPoint[] {
  if (!live || points.length < 2) return points;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < points.length; i++) {
    const dLat = points[i].latitude - live.latitude;
    const dLng = (points[i].longitude - live.longitude) * Math.cos((live.latitude * Math.PI) / 180);
    const d = dLat * dLat + dLng * dLng;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return [live, ...points.slice(best + 1)];
}

/** Seconds left in the free cancellation window (server clock corrected); 0 once it has closed. */
export function freeCancelSecondsLeft(a: Pick<CustomerAssignment, 'freeCancelUntil'>, clockOffsetMs = 0, now: number = Date.now()): number {
  return secondsLeft(a.freeCancelUntil, clockOffsetMs, now);
}

export interface ContactState {
  /** Phone visible and dialable. */
  canCall: boolean;
  canChat: boolean;
  /** Show the "unlocks ~5 minutes before arrival" explanation. */
  locked: boolean;
}

/** Zəng et / Mesaj yaz stay locked until the server unlocks the contact (spec 4.4). */
export function contactState(a: Pick<CustomerAssignment, 'contactUnlocked' | 'providerPhone' | 'chatEnabled'>): ContactState {
  const canCall = a.contactUnlocked && !!a.providerPhone;
  return { canCall, canChat: a.chatEnabled, locked: !a.contactUnlocked };
}

/** tel: link with only the characters a dialer accepts. */
export function telUrl(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

export type StepState = 'done' | 'current' | 'pending';

export interface TrackingStep {
  key: 'accepted' | 'enRoute' | 'arrived' | 'completed';
  state: StepState;
  time: string | null;
}

/** Timeline of board 03 seen from the customer: accepted → en route → arrived → completed, with Baku times. */
export function trackingSteps(a: CustomerAssignment): TrackingStep[] {
  const times: Record<TrackingStep['key'], string | null> = {
    accepted: a.acceptedAt,
    enRoute: a.enRouteAt,
    arrived: a.arrivedAt,
    completed: a.completedAt,
  };
  const keys: TrackingStep['key'][] = ['accepted', 'enRoute', 'arrived', 'completed'];
  const lastDone = keys.reduce((acc, k, i) => (times[k] ? i : acc), -1);
  const ended = a.status === 'COMPLETED' || !isActiveAssignment(a.status);
  return keys.map((key, i) => ({
    key,
    time: times[key] ? formatTime(times[key] as string) : null,
    state: i <= lastDone ? 'done' : i === lastDone + 1 && !ended ? 'current' : 'pending',
  }));
}

/** Other assignments of the same request (multi-handyman requests), active ones first. */
export function siblingAssignments(all: readonly CustomerAssignment[], currentId: string): CustomerAssignment[] {
  return all
    .filter((a) => a.id !== currentId)
    .sort((x, y) => Number(isActiveAssignment(y.status)) - Number(isActiveAssignment(x.status)) || x.slotIndex - y.slotIndex);
}

/** The screen the tracking view hands over to once the handyman has proposed the price or the job is done. */
export function nextCustomerStep(a: CustomerAssignment): 'pay' | 'rate' | null {
  if (a.actions.confirmPrice) return 'pay';
  if (a.status === 'COMPLETED' && a.actions.rate) return 'rate';
  return null;
}
