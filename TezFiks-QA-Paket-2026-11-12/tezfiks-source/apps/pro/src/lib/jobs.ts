import { formatTime, isLiveTracked, isTerminalAssignment, type AssignmentStatus, type FinalPriceEntry, type ProAssignment } from '@tezfiks/shared';
import { googleMapsWebUrl, googleNavigationUrl, serverNow, wazeUrl } from '@tezfiks/mobile';

/**
 * Who is looking at an assignment:
 * - `solo`: the solo handyman who owns it (GET /pro/assignments, FULL view);
 * - `worker`: a company worker the job was assigned to (GET /pro/assignments, WORKER_LIMITED view, board 04);
 * - `manager`: a company manager (GET /company/:companyId/assignments, FULL view).
 */
export type JobRole = 'solo' | 'worker' | 'manager';

/** Role of the pro-endpoint viewer: company jobs in the personal list are always the caller's worker jobs. */
export function proRole(a: Pick<ProAssignment, 'providerType' | 'view'>): JobRole {
  return a.view === 'WORKER_LIMITED' || a.providerType === 'COMPANY' ? 'worker' : 'solo';
}

/** What a screen may render for this viewer (spec 4.4; the client enforces it even if the server sent more). */
export interface JobVisibility {
  /** Customer description and problem photos. */
  description: boolean;
  /** Customer rating (stars, count). */
  customerRating: boolean;
  /** Final price (labour, materials, total), payment method, tip. */
  price: boolean;
  /** Platform request fee (company money for company jobs). */
  fee: boolean;
  /** Customer phone ("Zəng et") once unlocked. */
  customerPhone: boolean;
  /** In-app chat with the customer once unlocked. */
  chat: boolean;
  /** Worker card with phone (manager views). */
  worker: boolean;
}

/**
 * Rendering rules:
 * - company worker (WORKER_LIMITED, board 04): location/address, category, customer name + photo only. Never the
 *   description, photos, customer rating, price, fee, company money, phone or chat ("Digər detallar üçün idarəedici ilə
 *   əlaqə saxlayın");
 * - solo handyman and manager: everything the server sends (phone and chat only once contact is unlocked).
 */
export function jobVisibility(a: Pick<ProAssignment, 'view' | 'providerType' | 'contactUnlocked' | 'chatEnabled'>, role: JobRole): JobVisibility {
  const limited = role === 'worker' || a.view === 'WORKER_LIMITED';
  if (limited) {
    return { description: false, customerRating: false, price: false, fee: false, customerPhone: false, chat: false, worker: false };
  }
  return {
    description: true,
    customerRating: true,
    price: true,
    fee: true,
    customerPhone: !!a.contactUnlocked,
    chat: !!a.chatEnabled,
    worker: role === 'manager',
  };
}

/**
 * Strips the fields a company worker must never see from an assignment (defence in depth: the WORKER_LIMITED view
 * already omits them on the server). Screens render the result, so a stale or wrong payload cannot leak.
 */
export function redactForRole(a: ProAssignment, role: JobRole): ProAssignment {
  const v = jobVisibility(a, role);
  return {
    ...a,
    description: v.description ? a.description : null,
    photos: v.description ? a.photos ?? [] : [],
    customer: a.customer
      ? { ...a.customer, ratingAvg: v.customerRating ? a.customer.ratingAvg : null, ratingCount: v.customerRating ? a.customer.ratingCount : null }
      : a.customer,
    customerPhone: v.customerPhone ? a.customerPhone ?? null : null,
    price: v.price ? a.price ?? null : null,
    tipAmount: v.price ? a.tipAmount ?? null : null,
    paymentMethod: v.price ? a.paymentMethod ?? null : null,
    fee: v.fee ? a.fee ?? null : null,
    chatEnabled: v.chat,
    worker: v.worker ? a.worker : a.worker ? { ...a.worker, phone: null } : a.worker,
  };
}

/** Side that enters the final price of a company job ("Yekun qiyməti kim daxil edir?"); solo jobs: the handyman. */
export function canEnterPrice(
  a: Pick<ProAssignment, 'status'> & { actions?: Partial<ProAssignment['actions']> | null },
  role: JobRole,
  finalPriceEntry: FinalPriceEntry | null | undefined,
): boolean {
  if (a.status !== 'ARRIVED') return false;
  if (a.actions && a.actions.enterPrice === false) return false;
  if (role === 'solo') return true;
  if (role === 'worker') return finalPriceEntry === 'WORKER';
  return finalPriceEntry === 'MANAGER';
}

export type JobStep =
  | 'enRoute'
  /** Manager view while the worker is on the way (the worker's buttons are not the manager's). */
  | 'followWorker'
  | 'arrived'
  | 'enterPrice'
  /** ARRIVED, but the other company side enters the price. */
  | 'awaitingPriceEntry'
  /** PRICE_PROPOSED: the customer confirms and pays. */
  | 'awaitingCustomer'
  | 'disputed'
  | 'rateCustomer'
  | 'done'
  | 'cancelled';

/** Main action / state of the active job screen (board 03 B3 "Aktiv sifariş", board 04 worker screen). */
export function nextStep(
  a: Pick<ProAssignment, 'status' | 'ratedCustomer'> & { actions?: Partial<ProAssignment['actions']> | null },
  role: JobRole,
  finalPriceEntry: FinalPriceEntry | null | undefined,
): JobStep {
  switch (a.status) {
    case 'ACCEPTED':
      return role === 'manager' ? 'followWorker' : 'enRoute';
    case 'EN_ROUTE':
      return role === 'manager' ? 'followWorker' : 'arrived';
    case 'ARRIVED':
      return canEnterPrice(a, role, finalPriceEntry) ? 'enterPrice' : 'awaitingPriceEntry';
    case 'PRICE_PROPOSED':
      return 'awaitingCustomer';
    case 'PRICE_DISPUTED':
      return 'disputed';
    case 'COMPLETED':
      return role !== 'manager' && !a.ratedCustomer && a.actions?.rateCustomer !== false ? 'rateCustomer' : 'done';
    default:
      return 'cancelled';
  }
}

export const ACTIVE_JOB_STATUSES: readonly AssignmentStatus[] = ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'PRICE_PROPOSED', 'PRICE_DISPUTED'];

export function isActiveJob(status: AssignmentStatus): boolean {
  return ACTIVE_JOB_STATUSES.includes(status);
}

export type StepState = 'done' | 'current' | 'pending';

export interface JobTimelineStep {
  key: 'accepted' | 'enRoute' | 'arrived' | 'completed';
  /** "14:02" (Baku time) or null. */
  time: string | null;
  state: StepState;
}

/**
 * Timeline of board 03 B3: Sifariş qəbul edildi → Yola çıxdım → Ünvana çatdım → İş tamamlandı, with Baku times.
 * The first step without a time is `current` while the job is active; a cancelled job has no current step.
 */
export function timelineSteps(
  a: Pick<ProAssignment, 'status' | 'acceptedAt' | 'enRouteAt' | 'arrivedAt' | 'completedAt'>,
): JobTimelineStep[] {
  const raw: Array<{ key: JobTimelineStep['key']; at: string | null }> = [
    { key: 'accepted', at: a.acceptedAt ?? null },
    { key: 'enRoute', at: a.enRouteAt ?? null },
    { key: 'arrived', at: a.arrivedAt ?? null },
    { key: 'completed', at: a.completedAt ?? null },
  ];
  const cancelled = isTerminalAssignment(a.status) && a.status !== 'COMPLETED';
  let currentGiven = cancelled;
  return raw.map((s) => {
    if (s.at) return { key: s.key, time: formatTime(s.at), state: 'done' as const };
    if (!currentGiven) {
      currentGiven = true;
      return { key: s.key, time: null, state: 'current' as const };
    }
    return { key: s.key, time: null, state: 'pending' as const };
  });
}

export interface CancelInfo {
  allowed: boolean;
  /** Inside the free window (no fee, no strike). */
  free: boolean;
  /** Seconds left in the free window (0 when closed). */
  freeSecondsLeft: number;
}

/** Provider cancel (spec 4.1): ACCEPTED/EN_ROUTE; free while now <= freeCancelUntil, otherwise the fee stays and a strike is added. */
export function cancelInfo(
  a: Pick<ProAssignment, 'status' | 'freeCancelUntil'> & { actions?: Partial<ProAssignment['actions']> | null },
  serverNowMs: number,
): CancelInfo {
  const statusOk = a.status === 'ACCEPTED' || a.status === 'EN_ROUTE';
  const allowed = statusOk && a.actions?.cancel !== false;
  const until = Date.parse(a.freeCancelUntil);
  const left = Number.isFinite(until) ? Math.max(0, Math.ceil((until - serverNowMs) / 1000)) : 0;
  return { allowed, free: allowed && left > 0, freeSecondsLeft: allowed ? left : 0 };
}

export interface NavigationTargets {
  /** Google Maps turn-by-turn (google.navigation:q=lat,lng). */
  google: string;
  waze: string;
  /** Web directions (fallback and the shared link). */
  web: string;
  /** "Paylaş" text: address and a directions link (no phone, no customer data). */
  shareMessage: string;
}

/** Board 04 "Google Maps / Waze / Paylaş" link builders for a job location. */
export function navigationTargets(address: { lat: number; lng: number; formatted: string }, title?: string): NavigationTargets {
  const web = googleMapsWebUrl(address.lat, address.lng);
  return {
    google: googleNavigationUrl(address.lat, address.lng),
    waze: wazeUrl(address.lat, address.lng),
    web,
    shareMessage: [title, address.formatted, web].filter((x) => !!x && String(x).trim().length > 0).join('\n'),
  };
}

/** Flat details line ("Giriş 2, Mərtəbə 5, Mənzil 12") from the structured address; the labels come from i18n. */
export function addressDetails(
  address: Pick<ProAssignment['address'], 'block' | 'entrance' | 'floor' | 'apartment' | 'intercom'>,
  labels: { block: string; entrance: string; floor: string; apartment: string; intercom: string },
): string {
  const parts: string[] = [];
  if (address.block) parts.push(`${labels.block} ${address.block}`);
  if (address.entrance) parts.push(`${labels.entrance} ${address.entrance}`);
  if (address.floor) parts.push(`${labels.floor} ${address.floor}`);
  if (address.apartment) parts.push(`${labels.apartment} ${address.apartment}`);
  if (address.intercom) parts.push(`${labels.intercom} ${address.intercom}`);
  return parts.join(', ');
}

/** Location pings tagged with the assignment run at 5 s only while EN_ROUTE. */
/**
 * Whether this device reports its position every 5 s for the job: from acceptance for NOW/EMERGENCY jobs (or within an hour
 * of a scheduled job) and while en route, so the customer sees the pro live and the contact unlocks from the live ETA
 * (isLiveTracked; founder decision 2026-10-26). Managers never report (they are not the one driving).
 */
export function wantsRouteTracking(
  a: Pick<ProAssignment, 'status' | 'timing' | 'scheduledAt'> | null | undefined,
  role: JobRole,
  nowMs: number = serverNow(),
): boolean {
  return !!a && role !== 'manager' && isLiveTracked(a, nowMs);
}

export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export function statusTone(status: AssignmentStatus): StatusTone {
  switch (status) {
    case 'ACCEPTED':
    case 'EN_ROUTE':
      return 'info';
    case 'ARRIVED':
    case 'PRICE_PROPOSED':
      return 'warning';
    case 'PRICE_DISPUTED':
      return 'danger';
    case 'COMPLETED':
      return 'success';
    default:
      return 'neutral';
  }
}

/** Merges paginated assignment pages without duplicates: the first occurrence (the earlier page, i.e. the order the server listed it in) is kept. */
export function mergeJobPages<T extends { id: string }>(pages: ReadonlyArray<{ items: readonly T[] }>): T[] {
  const seen = new Map<string, T>();
  for (const p of pages) for (const it of p.items) if (!seen.has(it.id)) seen.set(it.id, it);
  return [...seen.values()];
}
