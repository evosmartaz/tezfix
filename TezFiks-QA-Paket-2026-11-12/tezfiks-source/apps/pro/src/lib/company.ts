import type { InviteView, MemberView, OfferCandidateWorker, OfferView } from '@tezfiks/shared';

/**
 * Manager mode (board 04): incoming company offers. Socket `offer:new` (target COMPANY) adds, `offer:closed` removes,
 * GET /company/:id/offers/current every 5 s replaces the open set (server is authoritative). Offers sent after a poll
 * was requested survive that poll.
 */
export interface CompanyOfferState {
  offers: Record<string, OfferView>;
  dismissed: Record<string, true>;
}

export const emptyCompanyOffers = (): CompanyOfferState => ({ offers: {}, dismissed: {} });

function ms(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

export function isCompanyOffer(o: OfferView, companyId: string): boolean {
  return o.target === 'COMPANY' && o.companyId === companyId;
}

export function addCompanyOffer(state: CompanyOfferState, o: OfferView, companyId: string): CompanyOfferState {
  if (!isCompanyOffer(o, companyId) || state.dismissed[o.id]) return state;
  const offers = { ...state.offers };
  if (o.status !== 'SENT') delete offers[o.id];
  else offers[o.id] = o;
  return { ...state, offers };
}

export function applyCompanyPoll(state: CompanyOfferState, items: readonly OfferView[], companyId: string, requestedAtServerMs?: number): CompanyOfferState {
  const next: Record<string, OfferView> = {};
  for (const o of items) if (isCompanyOffer(o, companyId) && o.status === 'SENT' && !state.dismissed[o.id]) next[o.id] = o;
  if (requestedAtServerMs !== undefined) {
    for (const o of Object.values(state.offers)) if (!next[o.id] && ms(o.sentAt) >= requestedAtServerMs) next[o.id] = o;
  }
  return { ...state, offers: next };
}

export function removeCompanyOffer(state: CompanyOfferState, id: string, opts: { dismiss?: boolean } = {}): CompanyOfferState {
  if (!state.offers[id] && !opts.dismiss) return state;
  const offers = { ...state.offers };
  delete offers[id];
  return { offers, dismissed: opts.dismiss ? { ...state.dismissed, [id]: true } : state.dismissed };
}

/** Open offers, soonest deadline first. */
export function openCompanyOffers(state: CompanyOfferState, serverNowMs: number): OfferView[] {
  return Object.values(state.offers)
    .filter((o) => o.status === 'SENT' && ms(o.expiresAt) > serverNowMs)
    .sort((a, b) => ms(a.expiresAt) - ms(b.expiresAt));
}

/** "Ustanı seçin": a worker can be sent when free ("Boşdur") and has the trade. Busy ("Sifarişdədir") rows are disabled. */
/** Free, online and with the trade; an offline worker is shown as "Oflayn" and cannot be picked (UX-P03, spec 6 eligibility). */
export function isSelectableWorker(w: Pick<OfferCandidateWorker, 'busy' | 'hasTrade' | 'online'>): boolean {
  return !w.busy && w.hasTrade && w.online;
}

/**
 * Picker order: selectable first, then by distance (unknown last), then rating. Busy workers stay visible (disabled).
 */
export function sortCandidates(workers: readonly OfferCandidateWorker[]): OfferCandidateWorker[] {
  return [...workers].sort((a, b) => {
    const sa = isSelectableWorker(a) ? 0 : 1;
    const sb = isSelectableWorker(b) ? 0 : 1;
    if (sa !== sb) return sa - sb;
    const da = a.distanceM ?? Number.POSITIVE_INFINITY;
    const db = b.distanceM ?? Number.POSITIVE_INFINITY;
    if (da !== db) return da - db;
    return (b.ratingAvg ?? 0) - (a.ratingAvg ?? 0);
  });
}

/**
 * Toggles a worker in the selection. At most `max` (= the offer's open slots) workers; a single-slot offer swaps the
 * selection; unavailable workers are ignored.
 */
export function toggleWorker(
  selected: readonly string[],
  worker: Pick<OfferCandidateWorker, 'handymanId' | 'busy' | 'hasTrade' | 'online'>,
  max: number,
): string[] {
  if (selected.includes(worker.handymanId)) return selected.filter((id) => id !== worker.handymanId);
  if (!isSelectableWorker(worker) || max <= 0) return [...selected];
  if (max === 1) return [worker.handymanId];
  if (selected.length >= max) return [...selected];
  return [...selected, worker.handymanId];
}

/** Drops selected workers that became unavailable or vanished (offer refresh) and trims to the open slots. */
export function reconcileSelection(selected: readonly string[], workers: readonly OfferCandidateWorker[], max: number): string[] {
  const ok = new Set(workers.filter(isSelectableWorker).map((w) => w.handymanId));
  return selected.filter((id) => ok.has(id)).slice(0, Math.max(0, max));
}

/** Default pick: the nearest free worker for each open slot. */
export function defaultSelection(workers: readonly OfferCandidateWorker[], max: number): string[] {
  return sortCandidates(workers)
    .filter(isSelectableWorker)
    .slice(0, Math.max(0, max))
    .map((w) => w.handymanId);
}

/** Members a job can be reassigned to (ACCEPTED only, server checks the rest): active workers with a profile, not busy. */
export function reassignCandidates(members: readonly MemberView[], currentHandymanId: string | null): MemberView[] {
  return members.filter((m) => m.status === 'ACTIVE' && !!m.handymanId && m.handymanId !== currentHandymanId && !m.busy);
}

/** "1,8 km" / "1.8 km" (en) for a candidate distance; null when unknown. */
export function kmLabel(distanceM: number | null | undefined, locale: string): string | null {
  if (distanceM === null || distanceM === undefined || !Number.isFinite(distanceM)) return null;
  const km = (Math.round(distanceM / 100) / 10).toFixed(1);
  return `${locale === 'en' ? km : km.replace('.', ',')} km`;
}

/** Invite links still usable: not revoked, not expired, not used up. */
export function liveInvites(items: readonly InviteView[], nowMs: number): InviteView[] {
  return items.filter((i) => !i.revokedAt && Date.parse(i.expiresAt) > nowMs && i.usedCount < i.maxUses);
}
