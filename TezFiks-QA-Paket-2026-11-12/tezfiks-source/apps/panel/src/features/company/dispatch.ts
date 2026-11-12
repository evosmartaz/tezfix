/**
 * Pure state logic of the company dispatch board (spec §5 "Eligibility (company)", board 04): the live list of incoming
 * offers (REST poll + socket `offer:new` / `offer:closed` + local expiry), the "Ustanı seçin" worker picker rules and the
 * grouping of active jobs. No React here: the board component and the unit tests share these functions.
 */
import type {
  AssignmentStatus,
  OfferCandidateWorker,
  OfferCloseReason,
  OfferView,
  ProAssignment,
  WorkerLive,
} from '@tezfiks/shared';

// ------------------------------------------------------------------------------------------------ offers state ---

/** Why an offer left the board. ACCEPTED / DECLINED come from this manager's own actions. */
export type OfferGoneReason = OfferCloseReason | 'ACCEPTED';

export interface OfferNotice {
  offerId: string;
  requestNumber: number;
  reason: OfferGoneReason;
}

export interface DispatchState {
  companyId: string;
  /** Open offers (status SENT, not expired), soonest expiry first. */
  offers: OfferView[];
  /** Local time (ms) each open offer was added (a poll that started earlier must not drop it). */
  addedAt: Record<string, number>;
  /** Server clock minus local clock (ms), measured from the last poll's `serverNow`. */
  clockOffsetMs: number;
  /** Offers that left the board (offerId -> reason, local ms): a stale poll or a late socket event never brings them back. */
  gone: Record<string, { reason: OfferGoneReason; at: number }>;
  /** Closures of offers that were on the board, for a short message ("taken by another provider", "expired"). */
  notices: OfferNotice[];
}

export type DispatchAction =
  | {
      type: 'sync';
      items: OfferView[];
      /** `serverNow` of the poll response. */
      serverNow: string;
      /** Local ms when the poll was sent / received. */
      requestedAt: number;
      receivedAt: number;
    }
  | { type: 'add'; offer: OfferView; now: number }
  | { type: 'close'; offerId: string; reason: OfferCloseReason; now: number }
  | { type: 'tick'; now: number }
  | { type: 'accepted'; offerId: string; now: number }
  | { type: 'declined'; offerId: string; now: number }
  | { type: 'dismissNotice'; offerId: string };

/** Gone entries are kept this long (longer than any offer TTL) and then forgotten. */
export const GONE_TTL_MS = 10 * 60_000;
/** At most this many closure notices are kept. */
export const MAX_NOTICES = 5;

export function initialDispatchState(
  companyId: string,
  initial?: { items: OfferView[]; serverNow: string } | null,
  now = Date.now(),
): DispatchState {
  const base: DispatchState = { companyId, offers: [], addedAt: {}, clockOffsetMs: 0, gone: {}, notices: [] };
  if (!initial) return base;
  return dispatchReducer(base, {
    type: 'sync',
    items: initial.items,
    serverNow: initial.serverNow,
    requestedAt: now,
    receivedAt: now,
  });
}

/** Server time now (ms), from a local timestamp and the measured clock offset. */
export function serverTime(state: Pick<DispatchState, 'clockOffsetMs'>, now: number): number {
  return now + state.clockOffsetMs;
}

/** Milliseconds left before the offer expires (never negative). */
export function remainingMs(offer: Pick<OfferView, 'expiresAt'>, state: Pick<DispatchState, 'clockOffsetMs'>, now: number): number {
  const exp = Date.parse(offer.expiresAt);
  if (!Number.isFinite(exp)) return 0;
  return Math.max(0, exp - serverTime(state, now));
}

/** "0:27", "4:05", "1:02:03" (countdown of an offer). */
export function countdownText(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Share of the offer window still left, 0..1 (progress bar). */
export function remainingRatio(offer: Pick<OfferView, 'sentAt' | 'expiresAt'>, state: Pick<DispatchState, 'clockOffsetMs'>, now: number): number {
  const sent = Date.parse(offer.sentAt);
  const exp = Date.parse(offer.expiresAt);
  if (!Number.isFinite(sent) || !Number.isFinite(exp) || exp <= sent) return 0;
  return Math.min(1, Math.max(0, (exp - serverTime(state, now)) / (exp - sent)));
}

function isOpen(offer: OfferView, companyId: string, serverNowMs: number): boolean {
  return (
    offer.target === 'COMPANY' &&
    offer.companyId === companyId &&
    offer.status === 'SENT' &&
    Date.parse(offer.expiresAt) > serverNowMs
  );
}

function sortOffers(offers: OfferView[]): OfferView[] {
  return [...offers].sort((a, b) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt) || a.requestNumber - b.requestNumber);
}

function pruneGone(gone: DispatchState['gone'], now: number): DispatchState['gone'] {
  let changed = false;
  const out: DispatchState['gone'] = {};
  for (const [id, g] of Object.entries(gone)) {
    if (now - g.at <= GONE_TTL_MS) out[id] = g;
    else changed = true;
  }
  return changed ? out : gone;
}

function removeOffer(
  state: DispatchState,
  offerId: string,
  reason: OfferGoneReason,
  now: number,
  notify: boolean,
): DispatchState {
  const existing = state.offers.find((o) => o.id === offerId);
  const gone = { ...pruneGone(state.gone, now), [offerId]: { reason, at: now } };
  if (!existing) return { ...state, gone };
  const { [offerId]: _dropped, ...addedAt } = state.addedAt;
  const notices = notify
    ? [...state.notices.filter((n) => n.offerId !== offerId), { offerId, requestNumber: existing.requestNumber, reason }].slice(
        -MAX_NOTICES,
      )
    : state.notices;
  return { ...state, offers: state.offers.filter((o) => o.id !== offerId), addedAt, gone, notices };
}

export function dispatchReducer(state: DispatchState, action: DispatchAction): DispatchState {
  switch (action.type) {
    case 'sync': {
      const serverNowMs = Date.parse(action.serverNow);
      const clockOffsetMs = Number.isFinite(serverNowMs) ? serverNowMs - action.receivedAt : state.clockOffsetMs;
      const nowServer = action.receivedAt + clockOffsetMs;
      const gone = pruneGone(state.gone, action.receivedAt);
      const fromPoll = action.items.filter((o) => !gone[o.id] && isOpen(o, state.companyId, nowServer));
      const ids = new Set(fromPoll.map((o) => o.id));
      // Socket offers that arrived while the poll was in flight are not in its response yet: keep them.
      const late = state.offers.filter(
        (o) => !ids.has(o.id) && (state.addedAt[o.id] ?? 0) >= action.requestedAt && isOpen(o, state.companyId, nowServer),
      );
      const offers = sortOffers([...fromPoll, ...late]);
      const addedAt: Record<string, number> = {};
      for (const o of offers) addedAt[o.id] = state.addedAt[o.id] ?? action.receivedAt;
      return { ...state, offers, addedAt, clockOffsetMs, gone };
    }
    case 'add': {
      const { offer } = action;
      if (state.gone[offer.id]) return state;
      if (!isOpen(offer, state.companyId, serverTime(state, action.now))) return state;
      const others = state.offers.filter((o) => o.id !== offer.id);
      return {
        ...state,
        offers: sortOffers([...others, offer]),
        addedAt: { ...state.addedAt, [offer.id]: state.addedAt[offer.id] ?? action.now },
      };
    }
    case 'close':
      return removeOffer(state, action.offerId, action.reason, action.now, true);
    case 'accepted':
      return removeOffer(state, action.offerId, 'ACCEPTED', action.now, false);
    case 'declined':
      return removeOffer(state, action.offerId, 'DECLINED', action.now, false);
    case 'tick': {
      const nowServer = serverTime(state, action.now);
      const expired = state.offers.filter((o) => Date.parse(o.expiresAt) <= nowServer);
      let next = state;
      for (const o of expired) next = removeOffer(next, o.id, 'EXPIRED', action.now, true);
      const gone = pruneGone(next.gone, action.now);
      return gone === next.gone ? next : { ...next, gone };
    }
    case 'dismissNotice': {
      if (!state.notices.some((n) => n.offerId === action.offerId)) return state;
      return { ...state, notices: state.notices.filter((n) => n.offerId !== action.offerId) };
    }
    default:
      return state;
  }
}

// ------------------------------------------------------------------------------------------- worker picker ---

export type WorkerBlock = 'BUSY' | 'NO_TRADE' | null;

export interface WorkerAvailability {
  /** The manager may send this worker (the API refuses busy workers and workers without the trade). */
  selectable: boolean;
  block: WorkerBlock;
  /** Offline workers can still be sent (they get a push), but the board warns. */
  offline: boolean;
}

export function workerAvailability(w: Pick<OfferCandidateWorker, 'busy' | 'hasTrade' | 'online'>): WorkerAvailability {
  const block: WorkerBlock = w.busy ? 'BUSY' : !w.hasTrade ? 'NO_TRADE' : null;
  return { selectable: block === null, block, offline: !w.online };
}

/** "Ustanı seçin" order: free before busy, online before offline, then nearest, then best rated. */
export function sortCandidates(workers: readonly OfferCandidateWorker[]): OfferCandidateWorker[] {
  const rank = (w: OfferCandidateWorker) => {
    const a = workerAvailability(w);
    return (a.selectable ? 0 : 2) + (a.offline ? 1 : 0);
  };
  return [...workers].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.distanceM ?? Number.MAX_SAFE_INTEGER) - (b.distanceM ?? Number.MAX_SAFE_INTEGER) ||
      (b.ratingAvg ?? 0) - (a.ratingAvg ?? 0) ||
      `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`, 'az'),
  );
}

/** How many workers the manager may send: one per open slot. */
export function pickLimit(offer: Pick<OfferView, 'slotsOpen'>): number {
  return Math.max(0, offer.slotsOpen);
}

export type PickError = 'LIMIT' | 'UNAVAILABLE' | null;

/**
 * Toggles a worker in the selection. Busy workers and workers without the trade cannot be picked. The selection never
 * exceeds the open slots: with one open slot a new pick replaces the previous one (radio behaviour); with more, picking
 * beyond the limit is refused with LIMIT.
 */
export function togglePick(
  selected: readonly string[],
  handymanId: string,
  offer: Pick<OfferView, 'slotsOpen' | 'candidateWorkers'>,
): { selected: string[]; error: PickError } {
  if (selected.includes(handymanId)) return { selected: selected.filter((id) => id !== handymanId), error: null };
  const worker = offer.candidateWorkers.find((w) => w.handymanId === handymanId);
  if (!worker || !workerAvailability(worker).selectable) return { selected: [...selected], error: 'UNAVAILABLE' };
  const limit = pickLimit(offer);
  if (limit === 0) return { selected: [...selected], error: 'LIMIT' };
  if (selected.length >= limit) {
    if (limit === 1) return { selected: [handymanId], error: null };
    return { selected: [...selected], error: 'LIMIT' };
  }
  return { selected: [...selected, handymanId], error: null };
}

/** Drops picks that became invalid after an offer update (worker now busy or gone, fewer open slots). */
export function prunePicks(selected: readonly string[], offer: Pick<OfferView, 'slotsOpen' | 'candidateWorkers'>): string[] {
  const valid = selected.filter((id) => {
    const w = offer.candidateWorkers.find((c) => c.handymanId === id);
    return !!w && workerAvailability(w).selectable;
  });
  return valid.slice(0, pickLimit(offer));
}

/** Initial pick: the best free online worker (board 04 shows the first worker selected), or nothing. */
export function defaultPicks(offer: Pick<OfferView, 'slotsOpen' | 'candidateWorkers'>): string[] {
  if (pickLimit(offer) === 0) return [];
  const first = sortCandidates(offer.candidateWorkers).find((w) => {
    const a = workerAvailability(w);
    return a.selectable && !a.offline;
  });
  return first ? [first.handymanId] : [];
}

/** "Qəbul et və göndər" is enabled for 1..slotsOpen selectable workers. */
export function canAccept(selected: readonly string[], offer: Pick<OfferView, 'slotsOpen' | 'candidateWorkers'>): boolean {
  return (
    selected.length >= 1 &&
    selected.length <= pickLimit(offer) &&
    new Set(selected).size === selected.length &&
    prunePicks(selected, offer).length === selected.length
  );
}

/** Fee held on the company wallet at acceptance: one request fee per sent worker. */
export function acceptFeeTotal(offer: Pick<OfferView, 'fee'>, workers: number): number {
  return offer.fee * Math.max(0, workers);
}

// ---------------------------------------------------------------------------------------- active jobs board ---

export const BOARD_COLUMNS = ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'PRICE'] as const;
export type BoardColumn = (typeof BOARD_COLUMNS)[number];

const COLUMN_OF: Partial<Record<AssignmentStatus, BoardColumn>> = {
  ACCEPTED: 'ACCEPTED',
  EN_ROUTE: 'EN_ROUTE',
  ARRIVED: 'ARRIVED',
  PRICE_PROPOSED: 'PRICE',
  PRICE_DISPUTED: 'PRICE',
};

export function boardColumn(status: AssignmentStatus): BoardColumn | null {
  return COLUMN_OF[status] ?? null;
}

/** Active jobs grouped by board column (terminal assignments are left out), oldest acceptance first. */
export function groupAssignments(items: readonly ProAssignment[]): Record<BoardColumn, ProAssignment[]> {
  const out: Record<BoardColumn, ProAssignment[]> = { ACCEPTED: [], EN_ROUTE: [], ARRIVED: [], PRICE: [] };
  for (const a of items) {
    const col = boardColumn(a.status);
    if (col) out[col].push(a);
  }
  for (const col of BOARD_COLUMNS) out[col].sort((a, b) => Date.parse(a.acceptedAt) - Date.parse(b.acceptedAt));
  return out;
}

// ------------------------------------------------------------------------------------------- realtime filters ---

/** Socket events reach every company room of the manager: only this company's events concern the board. */
export function isForCompany(payload: { companyId?: string | null } | null | undefined, companyId: string): boolean {
  return !!payload && payload.companyId === companyId;
}

/** `wallet:updated` for this company's wallet. */
export function isCompanyWalletEvent(
  payload: { owner: string; companyId: string | null } | null | undefined,
  companyId: string,
): boolean {
  return !!payload && payload.owner === 'company' && payload.companyId === companyId;
}

// ------------------------------------------------------------------------------------------------ worker map ---

export type WorkerMapState = 'busy' | 'online' | 'offline';

export function workerMapState(w: Pick<WorkerLive, 'busy' | 'isOnline'>): WorkerMapState {
  if (w.busy) return 'busy';
  return w.isOnline ? 'online' : 'offline';
}

export const WORKER_MARKER_COLORS: Record<WorkerMapState, string> = {
  online: '#00A971',
  busy: '#F59E0B',
  offline: '#94A3B8',
};

export interface WorkerMarker {
  id: string;
  lat: number;
  lng: number;
  color: string;
  label: string;
}

/** Map markers for workers with a known position (busy amber, free green, offline grey). */
export function workerMarkers(items: readonly WorkerLive[], label: (w: WorkerLive) => string): WorkerMarker[] {
  return items
    .filter((w) => typeof w.lat === 'number' && typeof w.lng === 'number' && Number.isFinite(w.lat) && Number.isFinite(w.lng))
    .map((w) => ({
      id: w.handymanId,
      lat: w.lat as number,
      lng: w.lng as number,
      color: WORKER_MARKER_COLORS[workerMapState(w)],
      label: label(w),
    }));
}

/** Counts for the map legend. */
export function workerCounts(items: readonly WorkerLive[]): Record<WorkerMapState, number> {
  const out: Record<WorkerMapState, number> = { online: 0, busy: 0, offline: 0 };
  for (const w of items) out[workerMapState(w)] += 1;
  return out;
}
