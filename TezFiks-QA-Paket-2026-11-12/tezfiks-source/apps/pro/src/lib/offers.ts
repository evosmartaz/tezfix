import type { OfferView } from '@tezfiks/shared';

/**
 * Incoming offers of a solo handyman (board 03 B2). Offers arrive over the socket (`offer:new`), are closed over the
 * socket (`offer:closed`) and are re-synchronised by polling GET /pro/offers/current every 5 s while online and on app
 * focus. The server is authoritative: a poll result replaces the open set. Times are compared with the server clock
 * (client now + offset from `serverNow`).
 */
export interface OfferQueueState {
  offers: Record<string, OfferView>;
  /** Offers the user declined or that failed to accept: never shown again even if a stale poll returns them. */
  dismissed: Record<string, true>;
  /** Offers already alerted (vibration/sound once per offer). */
  alerted: Record<string, true>;
}

export const emptyOfferQueue = (): OfferQueueState => ({ offers: {}, dismissed: {}, alerted: {} });

/**
 * Live offers (any timing, including the live dispatch of a scheduled request) are open for exactly `offerTtlSec`
 * (GET /config/public; server default 30 s, demo 15 s). Scheduled pre-offers ("Planlı sifarişlər", server step -1) stay
 * open until the live dispatch starts, at least a minute later. The offer view carries no step, so a SCHEDULED offer
 * whose window is longer than the TTL plus a small slack is treated as a pre-offer.
 */
export const DEFAULT_OFFER_TTL_SEC = 30;
let offerTtlSec = DEFAULT_OFFER_TTL_SEC;

/** Sets the live offer TTL from the public config (falls back to the default for invalid values). */
export function configureOfferTtl(sec: number | null | undefined): void {
  offerTtlSec = typeof sec === 'number' && Number.isFinite(sec) && sec > 0 ? sec : DEFAULT_OFFER_TTL_SEC;
}

/** Longest window (ms) of an offer still treated as live: TTL + max(15 s, TTL / 2) for clock skew and send delays. */
export function liveOfferMaxWindowMs(ttlSec: number = offerTtlSec): number {
  return (ttlSec + Math.max(15, ttlSec / 2)) * 1000;
}

function ms(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

/** True for offers shown in the incoming offer modal (immediate/emergency, or the live dispatch phase of a scheduled request). */
export function isLiveOffer(offer: OfferView): boolean {
  if (offer.target !== 'HANDYMAN') return false;
  if (offer.timing !== 'SCHEDULED') return true;
  return ms(offer.expiresAt) - ms(offer.sentAt) <= liveOfferMaxWindowMs();
}

export function isOpen(offer: OfferView, serverNowMs: number): boolean {
  return offer.status === 'SENT' && ms(offer.expiresAt) > serverNowMs;
}

/** Adds or updates offers received over the socket (non-live and non-SENT offers are ignored). */
export function addOffers(state: OfferQueueState, offers: readonly OfferView[]): OfferQueueState {
  let changed = false;
  const next = { ...state.offers };
  for (const o of offers) {
    if (!isLiveOffer(o) || state.dismissed[o.id]) continue;
    if (o.status !== 'SENT') {
      if (next[o.id]) {
        delete next[o.id];
        changed = true;
      }
      continue;
    }
    next[o.id] = o;
    changed = true;
  }
  return changed ? { ...state, offers: next } : state;
}

/**
 * Applies a poll of GET /pro/offers/current: the result is the complete open set, so offers missing from it were closed,
 * expired or taken. Offers that arrived over the socket after the poll was sent (`sentAt` later than `requestedAtServerMs`)
 * (or in the same millisecond) are kept because the poll could not have seen them.
 */
export function applyPoll(state: OfferQueueState, items: readonly OfferView[], requestedAtServerMs?: number): OfferQueueState {
  const next: Record<string, OfferView> = {};
  for (const o of items) {
    if (!isLiveOffer(o) || o.status !== 'SENT' || state.dismissed[o.id]) continue;
    next[o.id] = o;
  }
  if (requestedAtServerMs !== undefined) {
    for (const o of Object.values(state.offers)) {
      // sent in the same millisecond as the poll request: the poll may not have seen it either
      if (!next[o.id] && ms(o.sentAt) >= requestedAtServerMs) next[o.id] = o;
    }
  }
  return { ...state, offers: next };
}

/** `offer:closed`, or a local accept/decline/expiry. */
export function removeOffer(state: OfferQueueState, offerId: string, opts: { dismiss?: boolean } = {}): OfferQueueState {
  if (!state.offers[offerId] && !opts.dismiss) return state;
  const offers = { ...state.offers };
  delete offers[offerId];
  return { ...state, offers, dismissed: opts.dismiss ? { ...state.dismissed, [offerId]: true } : state.dismissed };
}

/** Drops offers whose `expiresAt` has passed on the server clock. */
export function pruneExpired(state: OfferQueueState, serverNowMs: number): OfferQueueState {
  const expired = Object.values(state.offers).filter((o) => !isOpen(o, serverNowMs));
  if (!expired.length) return state;
  const offers = { ...state.offers };
  for (const o of expired) delete offers[o.id];
  return { ...state, offers };
}

/** Open offers in display order: emergencies first, then the one expiring soonest, then the oldest. */
export function openOffers(state: OfferQueueState, serverNowMs: number): OfferView[] {
  return Object.values(state.offers)
    .filter((o) => isOpen(o, serverNowMs) && !state.dismissed[o.id])
    .sort(
      (a, b) =>
        Number(b.isEmergency) - Number(a.isEmergency) ||
        ms(a.expiresAt) - ms(b.expiresAt) ||
        ms(a.sentAt) - ms(b.sentAt) ||
        a.id.localeCompare(b.id),
    );
}

/** The offer shown in the modal now, and how many more are waiting. */
export function currentOffer(state: OfferQueueState, serverNowMs: number): { offer: OfferView | null; waiting: number } {
  const list = openOffers(state, serverNowMs);
  return { offer: list[0] ?? null, waiting: Math.max(0, list.length - 1) };
}

/** Marks an offer as alerted; returns whether it needed an alert (first time seen). */
export function markAlerted(state: OfferQueueState, offerId: string): { state: OfferQueueState; isNew: boolean } {
  if (state.alerted[offerId]) return { state, isNew: false };
  return { state: { ...state, alerted: { ...state.alerted, [offerId]: true } }, isNew: true };
}

/** The offer window length in seconds (progress bar of "Qəbul üçün 30 saniyə"). */
export function offerWindowSec(offer: OfferView): number {
  return Math.max(1, Math.round((ms(offer.expiresAt) - ms(offer.sentAt)) / 1000));
}

/** "2,4 km • ~12 dəq" parts: distance in km with one decimal, ETA minutes rounded up. */
export function distanceKm(distanceM: number | null): number | null {
  if (distanceM === null || !Number.isFinite(distanceM)) return null;
  return Math.round(distanceM / 100) / 10;
}

/**
 * One idempotency key per offer per accept attempt sequence: retries of the same "Qəbul et" (double tap, network
 * retry) reuse the key so the server holds the fee once.
 */
export function createAcceptKeyRegistry(newKey: () => string) {
  const keys = new Map<string, string>();
  return {
    keyFor(offerId: string): string {
      let k = keys.get(offerId);
      if (!k) {
        k = newKey();
        keys.set(offerId, k);
      }
      return k;
    },
    forget(offerId: string): void {
      keys.delete(offerId);
    },
  };
}
