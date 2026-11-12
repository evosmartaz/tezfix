import { describe, expect, it } from 'vitest';
import {
  OfferViewSchema,
  ProAssignmentSchema,
  CompanyViewSchema,
  MemberViewSchema,
  WorkerLiveSchema,
  ProviderProjectViewSchema,
  EarningsViewSchema,
  InvoiceViewSchema,
  InviteViewSchema,
} from '@tezfiks/shared';
import {
  BOARD_COLUMNS,
  GONE_TTL_MS,
  WORKER_MARKER_COLORS,
  acceptFeeTotal,
  boardColumn,
  canAccept,
  countdownText,
  defaultPicks,
  dispatchReducer,
  groupAssignments,
  initialDispatchState,
  isCompanyWalletEvent,
  isForCompany,
  pickLimit,
  prunePicks,
  remainingMs,
  remainingRatio,
  sortCandidates,
  togglePick,
  workerAvailability,
  workerCounts,
  workerMarkers,
  type DispatchState,
} from '@/features/company/dispatch';
import {
  CID,
  OTHER_CID,
  PID,
  assignment,
  candidate,
  candidates,
  companyView,
  earnings,
  invite,
  invoice,
  member,
  offer,
  providerProject,
  workerLive,
} from './company-fixtures';

const T0 = Date.parse('2026-10-25T10:00:00.000Z');

function stateWith(...offers: ReturnType<typeof offer>[]): DispatchState {
  return initialDispatchState(CID, { items: offers, serverNow: '2026-10-25T10:00:00.000Z' }, T0);
}

describe('fixtures match the contract', () => {
  it('parse with the shared schemas', () => {
    expect(OfferViewSchema.safeParse(offer()).success).toBe(true);
    expect(ProAssignmentSchema.safeParse(assignment()).success).toBe(true);
    expect(CompanyViewSchema.safeParse(companyView()).success).toBe(true);
    expect(MemberViewSchema.safeParse(member()).success).toBe(true);
    expect(WorkerLiveSchema.safeParse(workerLive()).success).toBe(true);
    expect(ProviderProjectViewSchema.safeParse(providerProject()).success).toBe(true);
    expect(EarningsViewSchema.safeParse(earnings).success).toBe(true);
    expect(InvoiceViewSchema.safeParse(invoice).success).toBe(true);
    expect(InviteViewSchema.safeParse(invite).success).toBe(true);
  });
});

describe('dispatch reducer: offers add / expire / close', () => {
  it('starts from the server-rendered poll and measures the server clock offset', () => {
    const s = initialDispatchState(CID, { items: [offer()], serverNow: '2026-10-25T10:00:05.000Z' }, T0);
    expect(s.offers.map((o) => o.id)).toEqual([PID.offer1]);
    expect(s.clockOffsetMs).toBe(5000);
    // 30 s window, server is already 5 s in.
    expect(remainingMs(s.offers[0]!, s, T0)).toBe(25_000);
    expect(countdownText(remainingMs(s.offers[0]!, s, T0))).toBe('0:25');
  });

  it('keeps only SENT, unexpired COMPANY offers of this company, soonest expiry first', () => {
    const s = stateWith(
      offer({ id: PID.offer1, expiresAt: '2026-10-25T10:00:40.000Z' }),
      offer({ id: PID.offer2, expiresAt: '2026-10-25T10:00:20.000Z', requestNumber: 2852 }),
      offer({ id: PID.offer3, companyId: OTHER_CID }),
      offer({ id: 'a4444444-4444-4444-8444-444444444444', status: 'ACCEPTED' }),
      offer({ id: 'a5555555-5555-4555-8555-555555555555', expiresAt: '2026-10-25T09:59:59.000Z' }),
      offer({ id: 'a6666666-6666-4666-8666-666666666666', target: 'HANDYMAN', companyId: null }),
    );
    expect(s.offers.map((o) => o.id)).toEqual([PID.offer2, PID.offer1]);
  });

  it('adds an offer:new for this company and ignores other companies, duplicates and expired ones', () => {
    let s = stateWith();
    s = dispatchReducer(s, { type: 'add', offer: offer(), now: T0 });
    expect(s.offers).toHaveLength(1);
    s = dispatchReducer(s, { type: 'add', offer: offer({ slotsOpen: 1, descriptionShort: 'updated' }), now: T0 + 1000 });
    expect(s.offers).toHaveLength(1);
    expect(s.offers[0]!.descriptionShort).toBe('updated');
    s = dispatchReducer(s, { type: 'add', offer: offer({ id: PID.offer2, companyId: OTHER_CID }), now: T0 });
    expect(s.offers).toHaveLength(1);
    s = dispatchReducer(s, { type: 'add', offer: offer({ id: PID.offer3 }), now: T0 + 31_000 });
    expect(s.offers.map((o) => o.id)).toEqual([PID.offer1]);
  });

  it('removes an offer on offer:closed and records a notice with the reason', () => {
    let s = stateWith(offer(), offer({ id: PID.offer2, requestNumber: 2852 }));
    s = dispatchReducer(s, { type: 'close', offerId: PID.offer1, reason: 'TAKEN', now: T0 + 2000 });
    expect(s.offers.map((o) => o.id)).toEqual([PID.offer2]);
    expect(s.notices).toEqual([{ offerId: PID.offer1, requestNumber: 2851, reason: 'TAKEN' }]);
    s = dispatchReducer(s, { type: 'dismissNotice', offerId: PID.offer1 });
    expect(s.notices).toEqual([]);
  });

  it('a closed offer never comes back from a late socket event or a stale poll', () => {
    let s = stateWith(offer());
    s = dispatchReducer(s, { type: 'close', offerId: PID.offer1, reason: 'CANCELLED', now: T0 + 1000 });
    s = dispatchReducer(s, { type: 'add', offer: offer(), now: T0 + 1500 });
    expect(s.offers).toHaveLength(0);
    s = dispatchReducer(s, {
      type: 'sync',
      items: [offer()],
      serverNow: '2026-10-25T10:00:02.000Z',
      requestedAt: T0 + 1800,
      receivedAt: T0 + 2000,
    });
    expect(s.offers).toHaveLength(0);
  });

  it('a close for an unknown offer only marks it gone (no notice)', () => {
    let s = stateWith();
    s = dispatchReducer(s, { type: 'close', offerId: PID.offer2, reason: 'TAKEN', now: T0 });
    expect(s.notices).toEqual([]);
    s = dispatchReducer(s, { type: 'add', offer: offer({ id: PID.offer2 }), now: T0 + 100 });
    expect(s.offers).toHaveLength(0);
  });

  it('expires offers on tick using the server clock, exactly at expiresAt', () => {
    let s = initialDispatchState(CID, { items: [offer()], serverNow: '2026-10-25T10:00:10.000Z' }, T0);
    // server = local + 10 s; the offer expires at server 10:00:30 = local T0 + 20 s.
    s = dispatchReducer(s, { type: 'tick', now: T0 + 19_999 });
    expect(s.offers).toHaveLength(1);
    expect(remainingMs(s.offers[0]!, s, T0 + 19_999)).toBe(1);
    s = dispatchReducer(s, { type: 'tick', now: T0 + 20_000 });
    expect(s.offers).toHaveLength(0);
    expect(s.notices).toEqual([{ offerId: PID.offer1, requestNumber: 2851, reason: 'EXPIRED' }]);
    expect(s.gone[PID.offer1]?.reason).toBe('EXPIRED');
  });

  it('own accept / decline removes the offer without a notice', () => {
    let s = stateWith(offer(), offer({ id: PID.offer2 }));
    s = dispatchReducer(s, { type: 'accepted', offerId: PID.offer1, now: T0 });
    s = dispatchReducer(s, { type: 'declined', offerId: PID.offer2, now: T0 });
    expect(s.offers).toEqual([]);
    expect(s.notices).toEqual([]);
    expect(s.gone[PID.offer1]?.reason).toBe('ACCEPTED');
    expect(s.gone[PID.offer2]?.reason).toBe('DECLINED');
  });

  it('a poll replaces the list but keeps socket offers that arrived while it was in flight', () => {
    let s = stateWith(offer());
    // offer2 arrives over the socket at T0+500, the poll was sent at T0+400 and does not contain it yet.
    s = dispatchReducer(s, { type: 'add', offer: offer({ id: PID.offer2, requestNumber: 2852 }), now: T0 + 500 });
    s = dispatchReducer(s, {
      type: 'sync',
      items: [],
      serverNow: '2026-10-25T10:00:00.600Z',
      requestedAt: T0 + 400,
      receivedAt: T0 + 600,
    });
    // offer1 is no longer SENT on the server (not in the poll): dropped. offer2 is younger than the poll: kept.
    expect(s.offers.map((o) => o.id)).toEqual([PID.offer2]);
    // The next poll that started after offer2 arrived is authoritative.
    s = dispatchReducer(s, {
      type: 'sync',
      items: [],
      serverNow: '2026-10-25T10:00:01.000Z',
      requestedAt: T0 + 900,
      receivedAt: T0 + 1000,
    });
    expect(s.offers).toEqual([]);
  });

  it('forgets gone offers after the TTL', () => {
    let s = stateWith(offer());
    s = dispatchReducer(s, { type: 'close', offerId: PID.offer1, reason: 'TAKEN', now: T0 });
    s = dispatchReducer(s, { type: 'tick', now: T0 + GONE_TTL_MS + 1 });
    expect(s.gone[PID.offer1]).toBeUndefined();
  });

  it('keeps at most five notices', () => {
    const ids = Array.from({ length: 7 }, (_, i) => `a${i}111111-1111-4111-8111-111111111111`);
    let s = stateWith(...ids.map((id, i) => offer({ id, requestNumber: 3000 + i })));
    for (const id of ids) s = dispatchReducer(s, { type: 'close', offerId: id, reason: 'TAKEN', now: T0 });
    expect(s.notices.map((n) => n.requestNumber)).toEqual([3002, 3003, 3004, 3005, 3006]);
  });

  it('countdown helpers', () => {
    expect(countdownText(0)).toBe('0:00');
    expect(countdownText(-5)).toBe('0:00');
    expect(countdownText(27_000)).toBe('0:27');
    expect(countdownText(26_001)).toBe('0:27');
    expect(countdownText(245_000)).toBe('4:05');
    expect(countdownText(3_723_000)).toBe('1:02:03');
    const s = stateWith(offer());
    expect(remainingRatio(s.offers[0]!, s, T0 + 15_000)).toBeCloseTo(0.5);
    expect(remainingRatio(s.offers[0]!, s, T0 + 60_000)).toBe(0);
  });
});

describe('worker picker rules', () => {
  it('busy workers and workers without the trade cannot be picked; offline ones can (with a warning)', () => {
    expect(workerAvailability(candidate())).toEqual({ selectable: true, block: null, offline: false });
    expect(workerAvailability(candidate({ busy: true }))).toEqual({ selectable: false, block: 'BUSY', offline: false });
    expect(workerAvailability(candidate({ hasTrade: false }))).toEqual({ selectable: false, block: 'NO_TRADE', offline: false });
    expect(workerAvailability(candidate({ online: false }))).toEqual({ selectable: true, block: null, offline: true });
  });

  it('sorts free online workers first, then by distance', () => {
    const list = sortCandidates([
      candidate({ handymanId: PID.kamran, busy: true, distanceM: 100 }),
      candidate({ handymanId: PID.nijat, online: false, distanceM: 50 }),
      candidate({ handymanId: PID.tural, distanceM: 3200 }),
      candidate({ handymanId: PID.rauf, distanceM: 1800 }),
    ]);
    expect(list.map((w) => w.handymanId)).toEqual([PID.rauf, PID.tural, PID.nijat, PID.kamran]);
  });

  it('never selects more workers than open slots', () => {
    const o = offer({ slotsOpen: 2, slotsRequested: 3, candidateWorkers: [...candidates, candidate({ handymanId: PID.nijat })] });
    expect(pickLimit(o)).toBe(2);
    let r = togglePick([], PID.rauf, o);
    expect(r).toEqual({ selected: [PID.rauf], error: null });
    r = togglePick(r.selected, PID.tural, o);
    expect(r).toEqual({ selected: [PID.rauf, PID.tural], error: null });
    r = togglePick(r.selected, PID.nijat, o);
    expect(r).toEqual({ selected: [PID.rauf, PID.tural], error: 'LIMIT' });
    // Unpicking frees a place.
    r = togglePick(r.selected, PID.rauf, o);
    expect(r).toEqual({ selected: [PID.tural], error: null });
  });

  it('with one open slot a new pick replaces the previous one', () => {
    const o = offer({ slotsOpen: 1 });
    expect(togglePick([PID.rauf], PID.tural, o)).toEqual({ selected: [PID.tural], error: null });
  });

  it('refuses busy, unknown and trade-less workers', () => {
    const o = offer({ slotsOpen: 3, candidateWorkers: [...candidates, candidate({ handymanId: PID.nijat, hasTrade: false })] });
    expect(togglePick([], PID.kamran, o)).toEqual({ selected: [], error: 'UNAVAILABLE' });
    expect(togglePick([PID.rauf], PID.nijat, o)).toEqual({ selected: [PID.rauf], error: 'UNAVAILABLE' });
    expect(togglePick([], 'c9999999-9999-4999-8999-999999999999', o)).toEqual({ selected: [], error: 'UNAVAILABLE' });
  });

  it('no open slots: nothing can be picked', () => {
    const o = offer({ slotsOpen: 0 });
    expect(togglePick([], PID.rauf, o)).toEqual({ selected: [], error: 'LIMIT' });
    expect(defaultPicks(o)).toEqual([]);
    expect(canAccept([PID.rauf], o)).toBe(false);
  });

  it('accept needs 1..slotsOpen selectable workers', () => {
    const o = offer({ slotsOpen: 2 });
    expect(canAccept([], o)).toBe(false);
    expect(canAccept([PID.rauf], o)).toBe(true);
    expect(canAccept([PID.rauf, PID.tural], o)).toBe(true);
    expect(canAccept([PID.rauf, PID.rauf], o)).toBe(false);
    expect(canAccept([PID.rauf, PID.kamran], o)).toBe(false);
    expect(canAccept([PID.rauf, PID.tural, PID.kamran], offer({ slotsOpen: 3 }))).toBe(false);
  });

  it('preselects the best free online worker (board 04) and drops picks that became invalid', () => {
    expect(defaultPicks(offer())).toEqual([PID.rauf]);
    expect(defaultPicks(offer({ candidateWorkers: [candidate({ busy: true }), candidate({ handymanId: PID.tural, online: false })] }))).toEqual([]);
    const updated = offer({
      slotsOpen: 1,
      candidateWorkers: [candidate({ busy: true }), candidates[1]!, candidates[2]!],
    });
    expect(prunePicks([PID.rauf, PID.tural], updated)).toEqual([PID.tural]);
    expect(prunePicks([PID.tural, 'c9999999-9999-4999-8999-999999999999'], offer({ slotsOpen: 2 }))).toEqual([PID.tural]);
  });

  it('fee held at acceptance is one request fee per sent worker', () => {
    expect(acceptFeeTotal(offer(), 1)).toBe(1000);
    expect(acceptFeeTotal(offer(), 3)).toBe(3000);
    expect(acceptFeeTotal(offer({ fee: 0, isGuaranteeFix: true }), 2)).toBe(0);
  });
});

describe('active jobs board', () => {
  it('groups active assignments by status column and leaves out finished ones', () => {
    const g = groupAssignments([
      assignment({ id: PID.asg2, status: 'EN_ROUTE', acceptedAt: '2026-10-25T10:02:00.000Z' }),
      assignment({ id: PID.asg1, status: 'ACCEPTED' }),
      assignment({ id: PID.asg3, status: 'PRICE_DISPUTED' }),
      assignment({ id: PID.asg4, status: 'COMPLETED' }),
      assignment({ id: 'd5555555-5555-4555-8555-555555555555', status: 'EN_ROUTE', acceptedAt: '2026-10-25T09:00:00.000Z' }),
      assignment({ id: 'd6666666-6666-4666-8666-666666666666', status: 'CANCELLED_FREE' }),
    ]);
    expect(BOARD_COLUMNS).toEqual(['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'PRICE']);
    expect(g.ACCEPTED.map((a) => a.id)).toEqual([PID.asg1]);
    expect(g.EN_ROUTE.map((a) => a.id)).toEqual(['d5555555-5555-4555-8555-555555555555', PID.asg2]);
    expect(g.ARRIVED).toEqual([]);
    expect(g.PRICE.map((a) => a.id)).toEqual([PID.asg3]);
    expect(boardColumn('PRICE_PROPOSED')).toBe('PRICE');
    expect(boardColumn('NO_SHOW')).toBeNull();
  });
});

describe('realtime filters and worker map', () => {
  it('only this company events concern the board', () => {
    expect(isForCompany({ companyId: CID }, CID)).toBe(true);
    expect(isForCompany({ companyId: OTHER_CID }, CID)).toBe(false);
    expect(isForCompany({ companyId: null }, CID)).toBe(false);
    expect(isCompanyWalletEvent({ owner: 'company', companyId: CID }, CID)).toBe(true);
    expect(isCompanyWalletEvent({ owner: 'handyman', companyId: null }, CID)).toBe(false);
    expect(isCompanyWalletEvent({ owner: 'company', companyId: OTHER_CID }, CID)).toBe(false);
  });

  it('builds markers for workers with a position, coloured by state', () => {
    const items = [
      workerLive(),
      workerLive({ handymanId: PID.tural, busy: true, assignmentId: PID.asg1 }),
      workerLive({ handymanId: PID.kamran, isOnline: false }),
      workerLive({ handymanId: PID.nijat, lat: null, lng: null }),
    ];
    const markers = workerMarkers(items, (w) => w.firstName);
    expect(markers.map((m) => [m.id, m.color])).toEqual([
      [PID.rauf, WORKER_MARKER_COLORS.online],
      [PID.tural, WORKER_MARKER_COLORS.busy],
      [PID.kamran, WORKER_MARKER_COLORS.offline],
    ]);
    expect(workerCounts(items)).toEqual({ online: 2, busy: 1, offline: 1 });
  });
});
