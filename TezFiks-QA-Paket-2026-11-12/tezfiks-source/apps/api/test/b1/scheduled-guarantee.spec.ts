import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { latLngToCell } from 'h3-js';
import { api } from '@tezfiks/shared';
import { createTestApp, type TestApp } from '../helpers/app';
import { BAKU, categoryId, createCompany, createCustomer, createSoloHandyman, tokenFor, type CreatedCustomer } from '../helpers/factories';
import { advance, cancellations, createRequest, dispatch, expectLedgerSound, goOnline, offersOf, onlyAssignment, pointInRing, setSettings } from './helpers';

const center = BAKU.center;
const MIN = 60_000;

describe('B1 scheduled requests and guarantee re-fix dispatch', () => {
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

  /** An existing accepted job of `handymanId` on a scheduled request at `at`. */
  async function bookScheduled(customer: CreatedCustomer, handymanId: string, userId: string, at: Date) {
    const req = await t.prisma.serviceRequest.create({
      data: {
        customerAccountId: customer.accountId,
        createdByUserId: customer.userId,
        categoryId: await categoryId(t, 'plumbing'),
        vertical: 'HOME',
        description: 'Başqa planlı iş',
        timing: 'SCHEDULED',
        scheduledAt: at,
        lat: center.lat,
        lng: center.lng,
        cell7: latLngToCell(center.lat, center.lng, 7),
        cell9: latLngToCell(center.lat, center.lng, 9),
        formatted: 'Bakı',
        status: 'ASSIGNED',
        isSearching: false,
        slots: { create: [{ index: 0, status: 'FILLED' }] },
      },
      include: { slots: true },
    });
    await t.prisma.assignment.create({
      data: {
        requestId: req.id,
        slotId: req.slots[0]!.id,
        providerType: 'SOLO',
        handymanId,
        acceptedByUserId: userId,
        status: 'ACCEPTED',
        acceptedAt: t.clock.now(),
        freeCancelUntil: t.clock.now(),
      },
    });
  }

  it('pre-offers at creation go to approved pros whose service area covers the cell, with the trade, balance and no job within ±2 h', async () => {
    const c = await createCustomer(t);
    const scheduledAt = new Date(t.clock.nowMs() + 3 * 3600_000);
    const covering = await createSoloHandyman(t, { balance: 2000, base: center, radiusKm: 10 });
    const notCovering = await createSoloHandyman(t, { balance: 2000, base: pointInRing(center, 8), radiusKm: 3 });
    const conflicted = await createSoloHandyman(t, { balance: 2000, base: center });
    const poor = await createSoloHandyman(t, { balance: 100, base: center });
    const co = await createCompany(t, { trades: ['plumbing'], workers: 1, balance: 5000, base: center });
    await bookScheduled(await createCustomer(t), conflicted.handymanId, conflicted.userId, new Date(scheduledAt.getTime() + 60 * MIN));

    const req = await createRequest(t, c, { timing: 'SCHEDULED', scheduledAt: scheduledAt.toISOString(), slots: 2 });
    const liveAt = scheduledAt.getTime() - 90 * MIN;
    const offers = await offersOf(t, req.id);
    expect(offers.map((o) => o.handymanId ?? o.companyId).sort()).toEqual([covering.handymanId, co.companyId].sort());
    for (const o of offers) expect(o).toMatchObject({ step: -1, status: 'SENT' });
    for (const o of offers) expect(o.expiresAt.getTime()).toBe(liveAt);
    for (const h of [notCovering, conflicted, poor]) expect(offers.some((o) => o.handymanId === h.handymanId)).toBe(false);

    const scheduledList = await t.client(covering.token).call(api.pro.scheduledOffers);
    expect(scheduledList.items.map((o) => o.requestId)).toEqual([req.id]);
    expect(scheduledList.items[0]).toMatchObject({ timing: 'SCHEDULED', scheduledAt: scheduledAt.toISOString() });
    expect((await t.client(covering.token).call(api.pro.offers)).items).toEqual([]);
    expect(await t.prisma.notification.count({ where: { userId: covering.userId, type: 'OFFER_NEW' } })).toBe(1);

    const r = await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: req.id } });
    expect(r.liveDispatchAt!.getTime()).toBe(liveAt);
    expect(r.searchEndsAt!.getTime()).toBe(scheduledAt.getTime() - 15 * MIN);
    expect(t.jobs.pending('dispatch.scheduledLive').map((j) => j.runAt.getTime())).toEqual([liveAt]);
    expect(t.jobs.pending('dispatch.scheduledUnfilled').map((j) => j.runAt.getTime())).toEqual([scheduledAt.getTime() - 15 * MIN]);
    expect(t.jobs.pending('dispatch.scheduledReminder').map((j) => (j.data as { kind: string }).kind)).toEqual(['1h']);
  });

  it('accepting a pre-offer, live rings at liveDispatchAt, reminders, unfilled slots at scheduledAt − 15 min', async () => {
    const c = await createCustomer(t);
    const scheduledAt = new Date(t.clock.nowMs() + 3 * 3600_000);
    const early = await createSoloHandyman(t, { balance: 2000, base: center, radiusKm: 10 });
    const req = await createRequest(t, c, { timing: 'SCHEDULED', scheduledAt: scheduledAt.toISOString(), slots: 2 });
    const pre = await t.prisma.offer.findFirstOrThrow({ where: { requestId: req.id, handymanId: early.handymanId } });
    const acc = await t.client(early.token).call(api.pro.acceptOffer, { params: { id: pre.id } });
    expect(acc.assignment).toMatchObject({ timing: 'SCHEDULED', status: 'ACCEPTED' });
    expect(await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: req.id } })).toMatchObject({ status: 'ASSIGNED', isSearching: true, dispatchStep: -1 });

    // A pre-booked job far in the future does not block live work.
    const nowReq = await createRequest(t, await createCustomer(t));
    await goOnline(t, early.handymanId, center);
    await t.prisma.offer.deleteMany({ where: { requestId: nowReq.id } });
    const now2 = await createRequest(t, await createCustomer(t));
    expect((await offersOf(t, now2.id)).map((o) => o.handymanId)).toEqual([early.handymanId]);
    await t.prisma.serviceRequest.updateMany({ where: { id: { in: [nowReq.id, now2.id] } }, data: { isSearching: false, status: 'CANCELLED' } });

    // Live dispatch at T − 90 min for the open slot.
    const live = await createSoloHandyman(t, { balance: 2000 });
    t.clock.advance(90 * MIN - 60_000);
    await t.jobs.runDue();
    await goOnline(t, live.handymanId, center);
    await advance(t, 60_000);
    const liveOffer = await t.prisma.offer.findFirstOrThrow({ where: { requestId: req.id, handymanId: live.handymanId } });
    expect(liveOffer).toMatchObject({ step: 0, ring: 0, status: 'SENT' });
    const liveToken = await tokenFor(t, live.userId, 'PRO'); // access tokens expire after 15 min of Clock time
    expect((await t.client(liveToken).call(api.pro.offers)).items.map((o) => o.id)).toEqual([liveOffer.id]);
    expect(await t.prisma.offer.findUniqueOrThrow({ where: { id: pre.id } })).toMatchObject({ status: 'ACCEPTED' });

    // Reminder at T − 1 h to the customer and the booked pro.
    await advance(t, 30 * MIN);
    expect(await t.prisma.notification.count({ where: { userId: c.userId, type: 'SCHEDULED_REMINDER' } })).toBe(1);
    expect(await t.prisma.notification.count({ where: { userId: early.userId, type: 'SCHEDULED_REMINDER' } })).toBe(1);

    // T − 15 min: the open slot becomes UNFILLED, the request stays ASSIGNED.
    await advance(t, 45 * MIN);
    const r = await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: req.id }, include: { slots: { orderBy: { index: 'asc' } } } });
    expect(r).toMatchObject({ status: 'ASSIGNED', isSearching: false });
    expect(r.slots.map((s) => s.status).sort()).toEqual(['FILLED', 'UNFILLED']);
    expect(await t.prisma.notification.count({ where: { userId: c.userId, type: 'SCHEDULED_UNFILLED' } })).toBe(1);
    await expectLedgerSound(t);
  });

  it('a scheduled request with nothing filled EXPIRES at its unfilled deadline', async () => {
    const c = await createCustomer(t);
    const scheduledAt = new Date(t.clock.nowMs() + 2 * 3600_000);
    const req = await createRequest(t, c, { timing: 'SCHEDULED', scheduledAt: scheduledAt.toISOString() });
    await advance(t, 30 * MIN);
    await advance(t, 76 * MIN);
    expect(await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: req.id } })).toMatchObject({ status: 'EXPIRED', isSearching: false });
    expect(await t.prisma.notification.count({ where: { userId: c.userId, type: 'SCHEDULED_UNFILLED' } })).toBe(1);
  });

  it('when liveDispatchAt is already past at creation, live rings start at once', async () => {
    const c = await createCustomer(t);
    const h = await createSoloHandyman(t, { balance: 2000 });
    await goOnline(t, h.handymanId, center);
    const req = await createRequest(t, c, { timing: 'SCHEDULED', scheduledAt: new Date(t.clock.nowMs() + 60 * MIN).toISOString() });
    const [o] = await offersOf(t, req.id);
    expect(o).toMatchObject({ handymanId: h.handymanId, step: 0 });
    expect(o!.expiresAt.getTime() - o!.sentAt.getTime()).toBe(30_000);
  });

  describe('guarantee re-fix requests', () => {
    async function original() {
      const c = await createCustomer(t);
      const h = await createSoloHandyman(t, { balance: 2000 });
      await goOnline(t, h.handymanId, center);
      const req = await createRequest(t, c);
      const offer = await t.prisma.offer.findFirstOrThrow({ where: { requestId: req.id, handymanId: h.handymanId } });
      const res = await t.client(h.token).call(api.pro.acceptOffer, { params: { id: offer.id } });
      await advance(t, 300_000);
      await t.prisma.assignment.update({ where: { id: res.assignment.id }, data: { status: 'COMPLETED', completedAt: t.clock.now(), endedAt: t.clock.now() } });
      await t.prisma.requestSlot.updateMany({ where: { requestId: req.id }, data: { status: 'DONE' } });
      await t.prisma.serviceRequest.update({ where: { id: req.id }, data: { status: 'COMPLETED' } });
      return { c, h, req, assignmentId: res.assignment.id };
    }

    it('the original pro gets the only offer first, without any fee (even with an empty wallet)', async () => {
      const { c, h, assignmentId } = await original();
      // Empty the pro's wallet: guarantee work needs no balance.
      const external = await t.ledger.platformAccountId('EXTERNAL');
      await t.ledger.post({ kind: 'ADMIN_ADJUSTMENT', idempotencyKey: 'drain', entries: [{ accountId: h.walletAccountId!, amount: -1000 }, { accountId: external, amount: 1000 }] });
      const other = await createSoloHandyman(t, { balance: 2000 });
      await goOnline(t, other.handymanId, center);
      const fixId = await dispatch(t).createGuaranteeFixRequest(assignmentId);
      const fix = await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: fixId } });
      expect(fix).toMatchObject({ isGuaranteeFix: true, originAssignmentId: assignmentId, preferredHandymanId: h.handymanId, timing: 'NOW', customerAccountId: c.accountId });
      const offers = await offersOf(t, fixId);
      expect(offers.map((o) => [o.handymanId, o.step])).toEqual([[h.handymanId, -1]]);
      expect(offers[0]!.expiresAt.getTime() - offers[0]!.sentAt.getTime()).toBe(10 * MIN);
      const view = (await t.client(h.token).call(api.pro.offers)).items[0]!;
      expect(view).toMatchObject({ isGuaranteeFix: true, fee: 0 });
      const acc = await t.client(h.token).call(api.pro.acceptOffer, { params: { id: offers[0]!.id } });
      expect(acc.assignment).toMatchObject({ isGuaranteeFix: true, fee: { amount: 0, captured: false, refunded: false } });
      const a = await onlyAssignment(t, fixId);
      expect(a.feeHoldId).toBeNull();
      await advance(t, 301_000);
      expect(await t.ledger.balance(h.walletAccountId!)).toEqual({ posted: 0, held: 0, available: 0 });
      // A late customer cancel of a guarantee job costs nothing.
      const out = await cancellations(t).apply(a.id, { actor: 'CUSTOMER', kind: 'CANCEL' });
      expect(out.outcome).toMatchObject({ customerPenalty: 0, providerCompensation: 0, feeAction: 'NONE' });
      expect(await t.ledger.balance(c.walletAccountId)).toEqual({ posted: 0, held: 0, available: 0 });
      await expectLedgerSound(t);
    });

    it('when the original pro does not take it within guaranteeOriginalProviderMin, normal rings follow (no fee needed)', async () => {
      const { h, assignmentId } = await original();
      const other = await createSoloHandyman(t, { balance: 0 });
      const fixId = await dispatch(t).createGuaranteeFixRequest(assignmentId);
      t.clock.advance(10 * MIN - 1000);
      await goOnline(t, other.handymanId, center);
      await goOnline(t, h.handymanId, center);
      await advance(t, 1000);
      const offers = await offersOf(t, fixId);
      expect(offers.find((o) => o.handymanId === h.handymanId)).toMatchObject({ status: 'EXPIRED' });
      expect(offers.find((o) => o.handymanId === other.handymanId)).toMatchObject({ status: 'SENT', step: 0 });
      expect(offers.filter((o) => o.handymanId === h.handymanId)).toHaveLength(1);
    });

    it('a company job is re-offered to the company first', async () => {
      const c = await createCustomer(t);
      const co = await createCompany(t, { trades: ['plumbing'], workers: 1, balance: 5000 });
      await goOnline(t, co.workers[0]!.handymanId, center);
      const req = await createRequest(t, c);
      const offer = await t.prisma.offer.findFirstOrThrow({ where: { requestId: req.id, companyId: co.companyId } });
      const res = await t.client(co.manager.token).call(api.company.acceptOffer, {
        params: { companyId: co.companyId, offerId: offer.id },
        body: { workerIds: [co.workers[0]!.handymanId] },
      });
      await t.prisma.assignment.update({ where: { id: res.assignments[0]!.id }, data: { status: 'COMPLETED', endedAt: t.clock.now() } });
      const fixId = await dispatch(t).createGuaranteeFixRequest(res.assignments[0]!.id);
      const offers = await offersOf(t, fixId);
      expect(offers.map((o) => [o.targetType, o.companyId])).toEqual([['COMPANY', co.companyId]]);
      const out = await t.client(co.manager.token).call(api.company.acceptOffer, {
        params: { companyId: co.companyId, offerId: offers[0]!.id },
        body: { workerIds: [co.workers[0]!.handymanId] },
      });
      expect(out.assignments[0]).toMatchObject({ isGuaranteeFix: true, fee: { amount: 0 } });
      expect(await t.ledger.balance(co.walletAccountId)).toEqual({ posted: 5000, held: 1000, available: 4000 });
      await expectLedgerSound(t);
    });
  });
});
