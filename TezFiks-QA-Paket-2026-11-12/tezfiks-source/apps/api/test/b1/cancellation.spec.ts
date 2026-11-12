import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, rooms } from '@tezfiks/shared';
import { createTestApp, type TestApp } from '../helpers/app';
import { BAKU, createCompany, createCustomer, createSoloHandyman, type CreatedCustomer, type CreatedHandyman } from '../helpers/factories';
import { inTx } from '../../src/infra/prisma.service';
import { advance, cancellations, createRequest, dispatch, expectLedgerSound, fees, goOnline, offersOf, onlyAssignment, setSettings } from './helpers';

const center = BAKU.center;

describe('B1 CancellationService matrix and whole-request cancel', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
    await setSettings(t, { minCandidates: 0 });
  });

  async function revenue() {
    return (await t.ledger.balance(await t.ledger.platformAccountId('REVENUE'))).posted;
  }
  async function promo() {
    return (await t.ledger.balance(await t.ledger.platformAccountId('PROMO'))).posted;
  }

  /** A customer, an online pro, a request and the accepted assignment. */
  async function accepted(opts: { customerBalance?: number; emergency?: boolean; proBalance?: number; extraPro?: boolean } = {}) {
    const c = await createCustomer(t, { balance: opts.customerBalance ?? 0 });
    const h = await createSoloHandyman(t, { balance: opts.proBalance ?? 2000 });
    await goOnline(t, h.handymanId, center);
    let extra: CreatedHandyman | null = null;
    if (opts.extraPro) {
      extra = await createSoloHandyman(t, { balance: 2000 });
      await goOnline(t, extra.handymanId, center);
    }
    const req = await createRequest(t, c, opts.emergency ? { timing: 'EMERGENCY' } : {});
    const offer = await t.prisma.offer.findFirstOrThrow({ where: { requestId: req.id, handymanId: h.handymanId } });
    const res = await t.client(h.token).call(api.pro.acceptOffer, { params: { id: offer.id } });
    return { c, h, extra, req, assignmentId: res.assignment.id };
  }

  async function wallet(x: CreatedCustomer | CreatedHandyman) {
    return t.ledger.balance(x.walletAccountId!);
  }

  it('customer cancels inside the free window: fee hold released, emergency hold released, no penalty, request CANCELLED', async () => {
    const { c, h, req, assignmentId } = await accepted({ customerBalance: 1000, emergency: true });
    const rev = await revenue();
    const out = await cancellations(t).apply(assignmentId, { actor: 'CUSTOMER', kind: 'CANCEL', byUserId: c.userId });
    expect(out.outcome).toMatchObject({ free: true, feeAction: 'RELEASE_HOLD', emergencyAction: 'RELEASE', customerPenalty: 0 });
    expect(out.assignment).toMatchObject({ status: 'CANCELLED_FREE', cancelledBy: 'CUSTOMER' });
    expect(out.assignment.endedAt).not.toBeNull();
    expect(await wallet(h)).toEqual({ posted: 2000, held: 0, available: 2000 });
    expect(await wallet(c)).toEqual({ posted: 1000, held: 0, available: 1000 });
    expect(await revenue()).toBe(rev);
    const r = await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: req.id }, include: { slots: true } });
    expect(r.status).toBe('CANCELLED');
    expect(r.slots[0]!.status).toBe('CANCELLED');
    expect(await t.prisma.notification.count({ where: { userId: h.userId, type: 'ASSIGNMENT_CANCELLED' } })).toBe(1);
    expect(t.realtime.sentTo(rooms.assignment(assignmentId), 'assignment:updated')).toHaveLength(1);
    // The fee-window job does nothing afterwards.
    await advance(t, 301_000);
    expect(await wallet(h)).toEqual({ posted: 2000, held: 0, available: 2000 });
    await expectLedgerSound(t);
  });

  it('provider cancels inside the free window: hold released, slot re-dispatched, the previous provider is never re-offered', async () => {
    const { c, h, extra, req, assignmentId } = await accepted({ customerBalance: 1000, emergency: true, extraPro: true });
    const out = await cancellations(t).apply(assignmentId, { actor: 'PROVIDER', kind: 'CANCEL', byUserId: h.userId });
    expect(out.assignment.status).toBe('CANCELLED_FREE');
    expect(out.outcome).toMatchObject({ redispatch: true, emergencyAction: 'KEEP' });
    expect(await wallet(h)).toEqual({ posted: 2000, held: 0, available: 2000 });
    // The emergency hold stays on the reopened slot.
    expect(await wallet(c)).toEqual({ posted: 1000, held: 500, available: 500 });
    const r = await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: req.id }, include: { slots: true } });
    expect(r).toMatchObject({ status: 'SEARCHING', isSearching: true, dispatchStep: 0 });
    expect(r.slots[0]).toMatchObject({ status: 'OPEN', currentAssignmentId: null });
    const offers = await offersOf(t, req.id);
    expect(offers.filter((o) => o.handymanId === h.handymanId)).toHaveLength(1);
    // `extra` was offered at the first search (TAKEN) and is not offered again either.
    expect(offers.filter((o) => o.handymanId === extra!.handymanId)).toHaveLength(1);
    const fresh = await createSoloHandyman(t, { balance: 2000 });
    await goOnline(t, fresh.handymanId, center);
    await t.prisma.serviceRequest.update({ where: { id: req.id }, data: { isSearching: false } });
    await t.prisma.requestSlot.updateMany({ where: { requestId: req.id }, data: { status: 'OPEN' } });
    const slot = r.slots[0]!;
    await dispatch(t).reopenSlot(slot.id);
    const again = await offersOf(t, req.id);
    expect(again.filter((o) => o.handymanId === h.handymanId)).toHaveLength(1);
    expect(again.filter((o) => o.handymanId === fresh.handymanId)).toHaveLength(1);
    expect(await t.prisma.notification.count({ where: { userId: c.userId, type: 'ASSIGNMENT_CANCELLED' } })).toBe(1);
    await expectLedgerSound(t);
  });

  it('late provider cancel: fee kept, strike, slot re-dispatched (emergency fee captured once; refunded if the slot stays unfilled)', async () => {
    const { c, h, req, assignmentId } = await accepted({ customerBalance: 1000, emergency: true });
    await advance(t, 300_000);
    expect(await wallet(h)).toEqual({ posted: 1000, held: 0, available: 1000 });
    const rev = await revenue();
    const out = await cancellations(t).apply(assignmentId, { actor: 'PROVIDER', kind: 'CANCEL', byUserId: h.userId, reason: 'Maşın xarab oldu' });
    expect(out.assignment).toMatchObject({ status: 'CANCELLED_BY_PROVIDER', cancelReason: 'Maşın xarab oldu' });
    expect(await wallet(h)).toEqual({ posted: 1000, held: 0, available: 1000 });
    expect(await revenue()).toBe(rev);
    expect((await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: h.handymanId } })).strikes).toBe(1);
    expect(await t.prisma.strikeEvent.findMany({ where: { handymanId: h.handymanId } })).toMatchObject([{ assignmentId, reason: 'LATE_PROVIDER_CANCEL' }]);
    const r = await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: req.id }, include: { slots: true } });
    expect(r).toMatchObject({ status: 'SEARCHING', isSearching: true });
    expect(r.slots[0]).toMatchObject({ status: 'OPEN', emergencyCaptured: true });
    expect(await wallet(c)).toEqual({ posted: 500, held: 0, available: 500 });
    // Nobody else is found: the captured emergency fee goes back to the customer.
    for (let i = 0; i < 10; i++) await advance(t, 20_000);
    const end = await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: req.id }, include: { slots: true } });
    expect(end.status).toBe('EXPIRED');
    expect(end.slots[0]).toMatchObject({ status: 'UNFILLED', emergencyRefunded: true });
    expect(await wallet(c)).toEqual({ posted: 1000, held: 0, available: 1000 });
    await expectLedgerSound(t);
  });

  it('late customer cancel: provider fee refunded + 10 AZN compensation, customer pays 15 AZN even into debt, platform keeps 5 AZN', async () => {
    const { c, h, req, assignmentId } = await accepted({ customerBalance: 0 });
    await advance(t, 300_000);
    const rev0 = await revenue();
    const promo0 = await promo();
    expect(await wallet(h)).toMatchObject({ posted: 1000 });
    const out = await cancellations(t).apply(assignmentId, { actor: 'CUSTOMER', kind: 'CANCEL', byUserId: c.userId });
    expect(out.assignment).toMatchObject({ status: 'CANCELLED_BY_CUSTOMER', feeRefunded: true });
    expect(out.outcome).toMatchObject({ feeAction: 'REFUND', customerPenalty: 1500, providerCompensation: 1000 });
    expect(await wallet(h)).toEqual({ posted: 3000, held: 0, available: 3000 });
    expect(await wallet(c)).toEqual({ posted: -1500, held: 0, available: -1500 });
    expect((await revenue()) - rev0).toBe(500);
    expect((await promo()) - promo0).toBe(-1000);
    expect((await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe('CANCELLED');
    const keys = (await t.prisma.ledgerTransaction.findMany({ where: { assignmentId } })).map((x) => x.idempotencyKey).sort();
    expect(keys).toEqual([`cancel-penalty:${assignmentId}`, `fee-capture:${assignmentId}`, `fee-refund:${assignmentId}`, `penalty-compensation:${assignmentId}`].sort());
    // The debt blocks the next request.
    await expect(createRequest(t, c)).rejects.toMatchObject({ code: 'CUSTOMER_IN_DEBT' });
    expect((await t.client(c.token).call(api.customer.getAccount)).account?.wallet).toMatchObject({ posted: -1500, isDebt: true });
    expect(await t.prisma.notification.count({ where: { userId: h.userId, type: 'ASSIGNMENT_CANCELLED' } })).toBe(1);
    await expectLedgerSound(t);
  });

  it('decline on arrival inside the free window: hold released (nothing captured), 15 AZN penalty, 10 AZN compensation', async () => {
    const { c, h, assignmentId } = await accepted({ customerBalance: 2000 });
    await t.prisma.assignment.update({ where: { id: assignmentId }, data: { status: 'ARRIVED', arrivedAt: t.clock.now() } });
    await expect(cancellations(t).apply(assignmentId, { actor: 'CUSTOMER', kind: 'CANCEL' })).rejects.toMatchObject({ code: 'CANCEL_NOT_ALLOWED' });
    const out = await cancellations(t).apply(assignmentId, { actor: 'CUSTOMER', kind: 'DECLINE_ON_ARRIVAL', byUserId: c.userId });
    expect(out.assignment.status).toBe('DECLINED_ON_ARRIVAL');
    expect(await wallet(h)).toEqual({ posted: 3000, held: 0, available: 3000 });
    expect(await wallet(c)).toEqual({ posted: 500, held: 0, available: 500 });
    await expectLedgerSound(t);
  });

  it('no-show: TOO_EARLY before noShowAfterMin; afterwards fee kept, strike, re-dispatch', async () => {
    const { c, h, req, assignmentId } = await accepted({ customerBalance: 0 });
    await expect(cancellations(t).apply(assignmentId, { actor: 'CUSTOMER', kind: 'NO_SHOW' })).rejects.toMatchObject({ code: 'TOO_EARLY', status: 409 });
    await advance(t, 45 * 60_000);
    const out = await cancellations(t).apply(assignmentId, { actor: 'CUSTOMER', kind: 'NO_SHOW', byUserId: c.userId });
    expect(out.assignment.status).toBe('NO_SHOW');
    expect(await wallet(h)).toEqual({ posted: 1000, held: 0, available: 1000 });
    expect(await wallet(c)).toEqual({ posted: 0, held: 0, available: 0 });
    expect(await t.prisma.strikeEvent.count({ where: { handymanId: h.handymanId, reason: 'NO_SHOW' } })).toBe(1);
    expect((await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: req.id } })).isSearching).toBe(true);
    await expectLedgerSound(t);
  });

  it('a late company cancel strikes the company; terminal assignments cannot be cancelled again', async () => {
    const c = await createCustomer(t);
    const co = await createCompany(t, { trades: ['plumbing'], workers: 1, balance: 5000 });
    await goOnline(t, co.workers[0]!.handymanId, center);
    const req = await createRequest(t, c);
    const offer = await t.prisma.offer.findFirstOrThrow({ where: { requestId: req.id, companyId: co.companyId } });
    const res = await t.client(co.manager.token).call(api.company.acceptOffer, {
      params: { companyId: co.companyId, offerId: offer.id },
      body: { workerIds: [co.workers[0]!.handymanId] },
    });
    const id = res.assignments[0]!.id;
    await advance(t, 300_000);
    await cancellations(t).apply(id, { actor: 'PROVIDER', kind: 'CANCEL', byUserId: co.manager.userId });
    expect((await t.prisma.company.findUniqueOrThrow({ where: { id: co.companyId } })).strikes).toBe(1);
    expect(await t.prisma.strikeEvent.count({ where: { companyId: co.companyId } })).toBe(1);
    expect(await t.ledger.balance(co.walletAccountId)).toEqual({ posted: 4000, held: 0, available: 4000 });
    await expect(cancellations(t).apply(id, { actor: 'PROVIDER', kind: 'CANCEL' })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expectLedgerSound(t);
  });

  it('admin force-cancel: provider fee refunded, no penalty, no strike; chargeCustomer applies the customer penalty', async () => {
    const first = await accepted({ customerBalance: 0 });
    await advance(t, 300_000);
    const out = await cancellations(t).apply(first.assignmentId, { actor: 'ADMIN', kind: 'CANCEL', reason: 'support' });
    expect(out.assignment).toMatchObject({ cancelledBy: 'ADMIN', feeRefunded: true });
    expect(await wallet(first.h)).toEqual({ posted: 2000, held: 0, available: 2000 });
    expect(await wallet(first.c)).toEqual({ posted: 0, held: 0, available: 0 });
    expect(await t.prisma.strikeEvent.count()).toBe(0);
    expect(await t.prisma.notification.count({ where: { userId: first.c.userId, type: 'ASSIGNMENT_CANCELLED' } })).toBe(1);
    expect(await t.prisma.notification.count({ where: { userId: first.h.userId, type: 'ASSIGNMENT_CANCELLED' } })).toBe(1);

    const second = await accepted({ customerBalance: 0 });
    const charged = await cancellations(t).apply(second.assignmentId, { actor: 'ADMIN', kind: 'CANCEL', chargeCustomer: true });
    expect(charged.assignment.status).toBe('CANCELLED_BY_CUSTOMER');
    expect(await wallet(second.c)).toEqual({ posted: -1500, held: 0, available: -1500 });
    expect(await wallet(second.h)).toEqual({ posted: 3000, held: 0, available: 3000 });
    await expectLedgerSound(t);
  });

  it('with tx: afterCommit is returned to the caller instead of running inside the transaction', async () => {
    const { h, assignmentId } = await accepted();
    const res = await inTx(t.prisma, (tx) => cancellations(t).apply(assignmentId, { actor: 'PROVIDER', kind: 'CANCEL' }, tx));
    expect(t.realtime.sentTo(rooms.assignment(assignmentId), 'assignment:updated')).toHaveLength(0);
    await res.afterCommit();
    expect(t.realtime.sentTo(rooms.assignment(assignmentId), 'assignment:updated')).toHaveLength(1);
    expect(await wallet(h)).toEqual({ posted: 2000, held: 0, available: 2000 });
  });

  it('5-minute boundary: a cancel just before freeCancelUntil is free, just after it is late', async () => {
    const first = await accepted({ customerBalance: 0 });
    const a1 = await onlyAssignment(t, first.req.id);
    t.clock.set(new Date(a1.freeCancelUntil.getTime() - 200));
    const early = await cancellations(t).apply(a1.id, { actor: 'CUSTOMER', kind: 'CANCEL' });
    expect(early.assignment.status).toBe('CANCELLED_FREE');
    expect(await wallet(first.c)).toEqual({ posted: 0, held: 0, available: 0 });

    t.clock.reset();
    const second = await accepted({ customerBalance: 0 });
    const a2 = await onlyAssignment(t, second.req.id);
    t.clock.set(new Date(a2.freeCancelUntil.getTime() + 1));
    const late = await cancellations(t).apply(a2.id, { actor: 'CUSTOMER', kind: 'CANCEL' });
    expect(late.assignment.status).toBe('CANCELLED_BY_CUSTOMER');
    expect(await wallet(second.c)).toEqual({ posted: -1500, held: 0, available: -1500 });
    expect(await wallet(second.h)).toEqual({ posted: 3000, held: 0, available: 3000 });
    await expectLedgerSound(t);
  });

  it('the fee-window capture racing a customer cancel at the boundary never double-moves money', async () => {
    for (let i = 0; i < 3; i++) {
      await t.reset();
      await setSettings(t, { minCandidates: 0 });
      const { c, h, req } = await accepted({ customerBalance: 1000, emergency: true });
      const a = await onlyAssignment(t, req.id);
      t.clock.set(new Date(a.freeCancelUntil.getTime() + 1));
      const [cap, can] = await Promise.allSettled([
        fees(t).captureForAssignment(a.id),
        cancellations(t).apply(a.id, { actor: 'CUSTOMER', kind: 'CANCEL' }),
      ]);
      expect(cap.status).toBe('fulfilled');
      expect(can.status).toBe('fulfilled');
      const after = await onlyAssignment(t, req.id);
      expect(after.status).toBe('CANCELLED_BY_CUSTOMER');
      // Fee refunded (or released) + compensation for the pro; penalty + captured emergency fee for the customer.
      expect(await wallet(h)).toEqual({ posted: 3000, held: 0, available: 3000 });
      expect(await wallet(c)).toEqual({ posted: -1000, held: 0, available: -1000 });
      expect(await t.prisma.ledgerTransaction.count({ where: { kind: 'REQUEST_FEE_CAPTURE' } })).toBeLessThanOrEqual(1);
      await expectLedgerSound(t);
      t.clock.reset();
    }
  });

  describe('whole-request cancel (POST /requests/:id/cancel)', () => {
    it('while searching without assignments: CANCELLED, offers closed, emergency holds released, timers stopped', async () => {
      const c = await createCustomer(t, { balance: 1000 });
      const h = await createSoloHandyman(t, { balance: 2000 });
      await goOnline(t, h.handymanId, center);
      const req = await createRequest(t, c, { timing: 'EMERGENCY', slots: 2 });
      const out = await t.client(c.token).call(api.requests.cancel, { params: { id: req.id }, body: { reason: 'Artıq lazım deyil' } });
      expect(out).toMatchObject({ status: 'CANCELLED', isSearching: false, cancelReason: 'Artıq lazım deyil', canCancel: false });
      expect(out.slots.map((s) => s.status)).toEqual(['CANCELLED', 'CANCELLED']);
      const [offer] = await offersOf(t, req.id);
      expect(offer).toMatchObject({ status: 'CLOSED', closeReason: 'CANCELLED' });
      expect(t.realtime.sentTo(rooms.user(h.userId), 'offer:closed').map((e) => (e.payload as { reason: string }).reason)).toEqual(['CANCELLED']);
      expect(await t.ledger.balance(c.walletAccountId)).toEqual({ posted: 1000, held: 0, available: 1000 });
      expect(t.jobs.pending('dispatch.step')).toHaveLength(0);
      expect(t.jobs.pending('dispatch.end')).toHaveLength(0);
      await expect(t.client(c.token).call(api.requests.cancel, { params: { id: req.id }, body: {} })).rejects.toMatchObject({ code: 'INVALID_STATE', status: 409 });
      await expectLedgerSound(t);
    });

    it('with an assignment after the window: the customer penalty applies per assignment; other users get NOT_FOUND', async () => {
      const { c, h, req } = await accepted({ customerBalance: 2000 });
      const stranger = await createCustomer(t);
      await expect(t.client(stranger.token).call(api.requests.cancel, { params: { id: req.id }, body: {} })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      const preview = await t.client(c.token).call(api.requests.get, { params: { id: req.id } });
      expect(preview).toMatchObject({ canCancel: true, cancelPenaltyPreview: 0 });
      expect(preview.assignments[0]!.actions).toMatchObject({ cancel: true, cancelPenalty: 0 });
      await advance(t, 300_000);
      const late = await t.client(c.token).call(api.requests.get, { params: { id: req.id } });
      expect(late.cancelPenaltyPreview).toBe(1500);
      const out = await t.client(c.token).call(api.requests.cancel, { params: { id: req.id }, body: {}, idempotencyKey: 'cancel-1' });
      expect(out).toMatchObject({ status: 'CANCELLED' });
      expect(out.assignments[0]).toMatchObject({ status: 'CANCELLED_BY_CUSTOMER', cancelledBy: 'CUSTOMER' });
      const replay = await t.client(c.token).call(api.requests.cancel, { params: { id: req.id }, body: {}, idempotencyKey: 'cancel-1' });
      expect(replay.id).toBe(out.id);
      expect(await t.ledger.balance(c.walletAccountId)).toEqual({ posted: 500, held: 0, available: 500 });
      expect(await t.ledger.balance(h.walletAccountId!)).toEqual({ posted: 3000, held: 0, available: 3000 });
      await expectLedgerSound(t);
    });

    it('cannot cancel while a price is proposed', async () => {
      const { c, req, assignmentId } = await accepted();
      await t.prisma.assignment.update({ where: { id: assignmentId }, data: { status: 'PRICE_PROPOSED' } });
      await expect(t.client(c.token).call(api.requests.cancel, { params: { id: req.id }, body: {} })).rejects.toMatchObject({ code: 'CANCEL_NOT_ALLOWED' });
      expect((await onlyAssignment(t, req.id)).status).toBe('PRICE_PROPOSED');
    });
  });
});
