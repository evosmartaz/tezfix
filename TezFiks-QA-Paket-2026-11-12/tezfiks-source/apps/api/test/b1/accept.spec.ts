import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, rooms } from '@tezfiks/shared';
import { createTestApp, type TestApp } from '../helpers/app';
import { BAKU, createCompany, createCustomer, createSoloHandyman } from '../helpers/factories';
import { OffersService } from '../../src/modules/requests/offers.service';
import { MeService } from '../../src/modules/users/me.service';
import { advance, createRequest, expectLedgerSound, goOnline, offersOf, onlyAssignment, presence, setSettings, views } from './helpers';

const center = BAKU.center;

describe('B1 offers: accept (solo and company), decline, seen, fee window', () => {
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

  async function soloOnline(balance = 2000) {
    const h = await createSoloHandyman(t, { balance });
    await goOnline(t, h.handymanId, center);
    return h;
  }

  async function offerFor(requestId: string, handymanId: string) {
    return t.prisma.offer.findFirstOrThrow({ where: { requestId, handymanId } });
  }

  it('solo accept: one transaction holds the fee, fills the slot, closes other offers, stops the search', async () => {
    const c = await createCustomer(t);
    const a = await soloOnline();
    const b = await soloOnline();
    const req = await createRequest(t, c);
    const offerA = await offerFor(req.id, a.handymanId);
    const offerB = await offerFor(req.id, b.handymanId);

    const res = await t.client(a.token).call(api.pro.acceptOffer, { params: { id: offerA.id } });
    expect(res.assignment).toMatchObject({
      requestId: req.id,
      requestNumber: req.number,
      status: 'ACCEPTED',
      view: 'FULL',
      providerType: 'SOLO',
      fee: { amount: 1000, captured: false, refunded: false },
      customerPhone: null,
      contactUnlocked: false,
      description: req.description,
      actions: { enRoute: true, arrived: true, enterPrice: false, cancel: true, cancelIsFree: true, rateCustomer: false },
    });
    expect(res.assignment.address.apartment).toBe('mənzil 45');
    expect(new Date(res.assignment.freeCancelUntil).getTime() - new Date(res.assignment.acceptedAt).getTime()).toBe(300_000);

    const assignment = await onlyAssignment(t, req.id);
    const hold = await t.prisma.hold.findUniqueOrThrow({ where: { id: assignment.feeHoldId! } });
    expect(hold).toMatchObject({ kind: 'REQUEST_FEE', status: 'ACTIVE', amount: 1000n, accountId: a.walletAccountId, assignmentId: assignment.id, slotId: assignment.slotId });
    expect(await t.ledger.balance(a.walletAccountId!)).toEqual({ posted: 2000, held: 1000, available: 1000 });
    const r = await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: req.id }, include: { slots: true } });
    expect(r).toMatchObject({ status: 'ASSIGNED', isSearching: false });
    expect(r.slots[0]).toMatchObject({ status: 'FILLED', currentAssignmentId: assignment.id });
    expect(await t.prisma.offer.findUniqueOrThrow({ where: { id: offerA.id } })).toMatchObject({ status: 'ACCEPTED' });
    expect(await t.prisma.offer.findUniqueOrThrow({ where: { id: offerB.id } })).toMatchObject({ status: 'CLOSED', closeReason: 'TAKEN' });
    expect(t.realtime.sentTo(rooms.user(b.userId), 'offer:closed').map((e) => e.payload)).toEqual([{ offerId: offerB.id, requestId: req.id, reason: 'TAKEN' }]);
    expect(t.realtime.sentTo(rooms.user(c.userId), 'request:updated').at(-1)!.payload).toEqual({ requestId: req.id, status: 'ASSIGNED' });
    expect(await t.prisma.notification.count({ where: { userId: c.userId, type: 'REQUEST_ASSIGNED' } })).toBe(1);
    expect(t.jobs.pending('dispatch.step')).toHaveLength(0);
    expect(t.jobs.pending('dispatch.end')).toHaveLength(0);
    expect(t.jobs.pending('assignment.feeWindowClose').map((j) => j.runAt.getTime())).toEqual([assignment.freeCancelUntil.getTime()]);
    expect((await presence(t).get(a.handymanId))?.busy).toBe(true);
    await expectLedgerSound(t);
  });

  it('two handymen accepting the last slot at the same time: exactly one wins, one hold', async () => {
    for (let round = 0; round < 3; round++) {
      await t.reset();
      await setSettings(t, { minCandidates: 0 });
      const c = await createCustomer(t);
      const a = await soloOnline();
      const b = await soloOnline();
      const req = await createRequest(t, c);
      const oa = await offerFor(req.id, a.handymanId);
      const ob = await offerFor(req.id, b.handymanId);
      const results = await Promise.allSettled([
        t.client(a.token).call(api.pro.acceptOffer, { params: { id: oa.id } }),
        t.client(b.token).call(api.pro.acceptOffer, { params: { id: ob.id } }),
      ]);
      expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
      const lost = results.find((x) => x.status === 'rejected') as PromiseRejectedResult;
      expect(lost.reason).toMatchObject({ code: 'OFFER_UNAVAILABLE', status: 409 });
      expect(await t.prisma.assignment.count({ where: { requestId: req.id } })).toBe(1);
      expect(await t.prisma.hold.count({ where: { kind: 'REQUEST_FEE', status: 'ACTIVE' } })).toBe(1);
      await expectLedgerSound(t);
    }
  });

  it('a multi-slot request is filled by a solo handyman and a company (two workers, one hold each on the company wallet)', async () => {
    const c = await createCustomer(t);
    const solo = await soloOnline();
    const co = await createCompany(t, { trades: ['plumbing'], workers: 3, balance: 5000 });
    for (const w of co.workers) await goOnline(t, w.handymanId, center);
    const req = await createRequest(t, c, { slots: 3 });
    const soloOffer = await offerFor(req.id, solo.handymanId);
    const coOffer = await t.prisma.offer.findFirstOrThrow({ where: { requestId: req.id, companyId: co.companyId } });

    await t.client(solo.token).call(api.pro.acceptOffer, { params: { id: soloOffer.id } });
    let r = await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: req.id } });
    expect(r).toMatchObject({ status: 'ASSIGNED', isSearching: true });
    expect(await t.prisma.offer.findUniqueOrThrow({ where: { id: coOffer.id } })).toMatchObject({ status: 'SENT' });

    const offerView = (await t.client(co.manager.token).call(api.company.offers, { params: { companyId: co.companyId } })).items[0]!;
    expect(offerView.slotsOpen).toBe(2);

    const workers = [co.workers[0]!.handymanId, co.workers[1]!.userId]; // handyman id or user id are both accepted
    const out = await t.client(co.manager.token).call(api.company.acceptOffer, {
      params: { companyId: co.companyId, offerId: coOffer.id },
      body: { workerIds: workers },
    });
    expect(out.assignments).toHaveLength(2);
    for (const v of out.assignments) {
      expect(v).toMatchObject({ providerType: 'COMPANY', view: 'FULL', company: { id: co.companyId }, fee: { amount: 1000 } });
      expect(v.worker.phone).toMatch(/^\+994/);
    }
    const rows = await t.prisma.assignment.findMany({ where: { requestId: req.id, providerType: 'COMPANY' } });
    expect(rows.map((x) => x.handymanId).sort()).toEqual([co.workers[0]!.handymanId, co.workers[1]!.handymanId].sort());
    expect(rows.every((x) => x.acceptedByUserId === co.manager.userId && x.companyId === co.companyId)).toBe(true);
    expect(await t.ledger.balance(co.walletAccountId)).toEqual({ posted: 5000, held: 2000, available: 3000 });
    r = await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: req.id } });
    expect(r).toMatchObject({ status: 'ASSIGNED', isSearching: false });
    for (const w of [co.workers[0]!, co.workers[1]!]) {
      expect(await t.prisma.notification.count({ where: { userId: w.userId, type: 'WORKER_ASSIGNED' } })).toBe(1);
    }
    // The worker sees the limited view (board 04).
    const workerView = await views(t).toProAssignment(rows[0]!.id, co.workers.find((w) => w.handymanId === rows[0]!.handymanId)!.userId, 'az');
    expect(workerView).toMatchObject({ view: 'WORKER_LIMITED', description: null, photos: [], fee: null, customerPhone: null, tipAmount: null });
    expect(workerView.customer.ratingAvg).toBeNull();
    expect(workerView.customer.ratingCount).toBeNull();
    expect(workerView.worker.phone).toBeNull();
    await expectLedgerSound(t);
  });

  it('company accept validation: manager only, approved company, workers must be free members with the trade, at most the open slots', async () => {
    const c = await createCustomer(t);
    const co = await createCompany(t, { trades: ['plumbing'], workers: 3, balance: 5000 });
    const otherCo = await createCompany(t, { trades: ['plumbing'], workers: 1, balance: 5000 });
    for (const w of co.workers) await goOnline(t, w.handymanId, center);
    const req = await createRequest(t, c, { slots: 2, providerPreference: 'ANY' });
    const offer = await t.prisma.offer.findFirstOrThrow({ where: { requestId: req.id, companyId: co.companyId } });
    const call = (token: string, workerIds: string[], companyId = co.companyId) =>
      t.client(token).call(api.company.acceptOffer, { params: { companyId, offerId: offer.id }, body: { workerIds } });

    await expect(call(co.workers[0]!.token, [co.workers[0]!.handymanId])).rejects.toMatchObject({ code: 'NOT_COMPANY_MANAGER', status: 403 });
    await expect(call(otherCo.manager.token, [co.workers[0]!.handymanId])).rejects.toMatchObject({ code: 'NOT_COMPANY_MANAGER' });
    await expect(call(otherCo.manager.token, [otherCo.workers[0]!.handymanId], otherCo.companyId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(call(co.manager.token, [otherCo.workers[0]!.handymanId])).rejects.toMatchObject({ code: 'WORKER_UNAVAILABLE', status: 409 });
    await expect(call(co.manager.token, [co.workers[0]!.handymanId, co.workers[0]!.handymanId])).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(call(co.manager.token, co.workers.map((w) => w.handymanId))).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    await t.prisma.handymanTrade.deleteMany({ where: { handymanId: co.workers[1]!.handymanId } });
    await expect(call(co.manager.token, [co.workers[1]!.handymanId])).rejects.toMatchObject({ code: 'WORKER_UNAVAILABLE', details: { reason: 'NO_TRADE' } });
    await t.prisma.companyMember.updateMany({ where: { userId: co.workers[2]!.userId }, data: { status: 'REMOVED' } });
    await expect(call(co.manager.token, [co.workers[2]!.handymanId])).rejects.toMatchObject({ code: 'WORKER_UNAVAILABLE', details: { reason: 'NOT_A_MEMBER' } });

    // A busy worker (already on a job) cannot be sent.
    const solo = await createSoloHandyman(t, { balance: 0 });
    void solo;
    const other = await createRequest(t, await createCustomer(t));
    const slot = await t.prisma.requestSlot.findFirstOrThrow({ where: { requestId: other.id } });
    await t.prisma.assignment.create({
      data: {
        requestId: other.id,
        slotId: slot.id,
        providerType: 'COMPANY',
        handymanId: co.workers[0]!.handymanId,
        companyId: co.companyId,
        acceptedByUserId: co.manager.userId,
        status: 'ARRIVED',
        acceptedAt: t.clock.now(),
        freeCancelUntil: t.clock.now(),
      },
    });
    await expect(call(co.manager.token, [co.workers[0]!.handymanId])).rejects.toMatchObject({ code: 'WORKER_UNAVAILABLE', details: { reason: 'BUSY' } });

    await t.prisma.company.update({ where: { id: co.companyId }, data: { status: 'BLOCKED' } });
    await expect(call(co.manager.token, [co.workers[0]!.handymanId])).rejects.toMatchObject({ code: 'COMPANY_NOT_APPROVED', status: 403 });
    expect(await t.prisma.assignment.count({ where: { requestId: req.id } })).toBe(0);
    expect(await t.prisma.hold.count({ where: { kind: 'REQUEST_FEE' } })).toBe(0);
  });

  it('idempotent accept: replaying the same Idempotency-Key returns the same assignment and holds once', async () => {
    const c = await createCustomer(t);
    const h = await soloOnline();
    const req = await createRequest(t, c);
    const o = await offerFor(req.id, h.handymanId);
    const first = await t.client(h.token).call(api.pro.acceptOffer, { params: { id: o.id }, idempotencyKey: 'accept-1' });
    const again = await t.client(h.token).call(api.pro.acceptOffer, { params: { id: o.id }, idempotencyKey: 'accept-1' });
    expect(again.assignment.id).toBe(first.assignment.id);
    expect(await t.prisma.hold.count({ where: { kind: 'REQUEST_FEE' } })).toBe(1);
    await expect(t.client(h.token).call(api.pro.acceptOffer, { params: { id: o.id }, idempotencyKey: 'accept-2' })).rejects.toMatchObject({
      code: 'OFFER_UNAVAILABLE',
    });
  });

  it('accept errors: OFFER_EXPIRED, NOT_FOUND for another pro, NOT_ELIGIBLE, INSUFFICIENT_BALANCE (nothing created)', async () => {
    const c = await createCustomer(t);
    const h = await soloOnline();
    const intruder = await soloOnline();
    const req = await createRequest(t, c, { slots: 1 });
    const o = await offerFor(req.id, h.handymanId);
    await expect(t.client(intruder.token).call(api.pro.acceptOffer, { params: { id: o.id } })).rejects.toMatchObject({ code: 'NOT_FOUND' });

    // Not eligible any more: blocked after the offer.
    await t.prisma.handymanProfile.update({ where: { id: h.handymanId }, data: { status: 'BLOCKED' } });
    await expect(t.client(h.token).call(api.pro.acceptOffer, { params: { id: o.id } })).rejects.toMatchObject({ code: 'NOT_ELIGIBLE', status: 403 });
    await t.prisma.handymanProfile.update({ where: { id: h.handymanId }, data: { status: 'APPROVED' } });

    // Not enough available balance (another hold reserves it).
    await t.ledger.hold({ accountId: h.walletAccountId!, amount: 1500, kind: 'B2B_QUOTE_FEE' });
    await expect(t.client(h.token).call(api.pro.acceptOffer, { params: { id: o.id } })).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE', status: 402 });
    expect(await t.prisma.assignment.count()).toBe(0);
    expect(await t.prisma.requestSlot.count({ where: { requestId: req.id, status: 'OPEN' } })).toBe(1);

    // Expired (deadline passed even before the expiry job ran).
    t.clock.advance(31_000);
    await expect(t.client(h.token).call(api.pro.acceptOffer, { params: { id: o.id } })).rejects.toMatchObject({ code: 'OFFER_EXPIRED', status: 409 });
    await t.jobs.runDue();
    await expect(t.client(h.token).call(api.pro.acceptOffer, { params: { id: o.id } })).rejects.toMatchObject({ code: 'OFFER_EXPIRED' });
  });

  it('a busy handyman cannot accept another live offer (NOT_ELIGIBLE)', async () => {
    const h = await soloOnline(5000);
    const r1 = await createRequest(t, await createCustomer(t));
    const r2 = await createRequest(t, await createCustomer(t));
    const o1 = await offerFor(r1.id, h.handymanId);
    const o2 = await offerFor(r2.id, h.handymanId);
    await t.client(h.token).call(api.pro.acceptOffer, { params: { id: o1.id } });
    await expect(t.client(h.token).call(api.pro.acceptOffer, { params: { id: o2.id } })).rejects.toMatchObject({
      code: 'NOT_ELIGIBLE',
      details: { reason: 'BUSY' },
    });
  });

  it('account deletion race on accept: the users row is locked FOR SHARE (blocked -> USER_BLOCKED, deleted -> FORBIDDEN)', async () => {
    const c = await createCustomer(t);
    const h = await soloOnline();
    const req = await createRequest(t, c);
    const o = await offerFor(req.id, h.handymanId);
    const svc = t.app.get(OffersService);
    await t.prisma.user.update({ where: { id: h.userId }, data: { status: 'BLOCKED' } });
    await expect(svc.acceptSolo(h.userId, o.id, 'az')).rejects.toMatchObject({ code: 'USER_BLOCKED' });
    await t.prisma.user.update({ where: { id: h.userId }, data: { status: 'DELETED' } });
    await expect(svc.acceptSolo(h.userId, o.id, 'az')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await t.prisma.assignment.count()).toBe(0);

    // Concurrent deleteAccount and accept: never an assignment for a deleted handyman.
    await t.prisma.user.update({ where: { id: h.userId }, data: { status: 'ACTIVE' } });
    const [accepted] = await Promise.allSettled([svc.acceptSolo(h.userId, o.id, 'az'), t.app.get(MeService).deleteAccount(h.userId)]);
    const user = await t.prisma.user.findUniqueOrThrow({ where: { id: h.userId } });
    const count = await t.prisma.assignment.count({ where: { handymanId: h.handymanId } });
    if (user.status === 'DELETED') {
      expect(accepted.status).toBe('rejected');
      expect(count).toBe(0);
    } else {
      expect(accepted.status).toBe('fulfilled');
      expect(count).toBe(1);
    }

    // Company accept: a deleted manager cannot accept either.
    const co = await createCompany(t, { trades: ['plumbing'], workers: 1, balance: 5000 });
    await goOnline(t, co.workers[0]!.handymanId, center);
    const r2 = await createRequest(t, await createCustomer(t));
    const coOffer = await t.prisma.offer.findFirstOrThrow({ where: { requestId: r2.id, companyId: co.companyId } });
    await t.prisma.user.update({ where: { id: co.manager.userId }, data: { status: 'DELETED' } });
    await expect(svc.acceptCompany(co.manager.userId, co.companyId, coOffer.id, [co.workers[0]!.handymanId], 'az')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('decline and seen', async () => {
    const c = await createCustomer(t);
    const h = await soloOnline();
    const other = await soloOnline();
    const req = await createRequest(t, c);
    const o = await offerFor(req.id, h.handymanId);
    await expect(t.client(other.token).call(api.pro.seenOffer, { params: { id: o.id } })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await t.client(h.token).call(api.pro.seenOffer, { params: { id: o.id } })).toEqual({ ok: true });
    const seen = await t.prisma.offer.findUniqueOrThrow({ where: { id: o.id } });
    expect(seen.seenAt).not.toBeNull();
    expect(seen.deliveredAt).not.toBeNull();
    expect(await t.client(h.token).call(api.pro.declineOffer, { params: { id: o.id } })).toEqual({ ok: true });
    expect(await t.prisma.offer.findUniqueOrThrow({ where: { id: o.id } })).toMatchObject({ status: 'DECLINED', closeReason: 'DECLINED' });
    expect(await t.client(h.token).call(api.pro.declineOffer, { params: { id: o.id } })).toEqual({ ok: true });
    await expect(t.client(h.token).call(api.pro.acceptOffer, { params: { id: o.id } })).rejects.toMatchObject({ code: 'OFFER_UNAVAILABLE' });

    const co = await createCompany(t, { trades: ['plumbing'], workers: 1, balance: 5000 });
    await goOnline(t, co.workers[0]!.handymanId, center);
    const r2 = await createRequest(t, await createCustomer(t));
    const coOffer = await t.prisma.offer.findFirstOrThrow({ where: { requestId: r2.id, companyId: co.companyId } });
    await expect(t.client(co.workers[0]!.token).call(api.company.declineOffer, { params: { companyId: co.companyId, offerId: coOffer.id } })).rejects.toMatchObject({
      code: 'NOT_COMPANY_MANAGER',
    });
    expect(await t.client(co.manager.token).call(api.company.declineOffer, { params: { companyId: co.companyId, offerId: coOffer.id } })).toEqual({ ok: true });
    expect(await t.prisma.offer.findUniqueOrThrow({ where: { id: coOffer.id } })).toMatchObject({ status: 'DECLINED' });
  });

  it('fee capture when the free-cancel window closes (request fee and the slot emergency fee to REVENUE)', async () => {
    const c = await createCustomer(t, { balance: 1000 });
    const h = await soloOnline(3000);
    const req = await createRequest(t, c, { timing: 'EMERGENCY' });
    const o = await offerFor(req.id, h.handymanId);
    await t.client(h.token).call(api.pro.acceptOffer, { params: { id: o.id } });
    const revenue = await t.ledger.platformAccountId('REVENUE');
    const revenueBefore = (await t.ledger.balance(revenue)).posted;
    await advance(t, 299_000);
    let a = await onlyAssignment(t, req.id);
    expect(a.feeCaptured).toBe(false);
    await advance(t, 1_000);
    a = await onlyAssignment(t, req.id);
    expect(a.feeCaptured).toBe(true);
    expect(await t.prisma.hold.findUniqueOrThrow({ where: { id: a.feeHoldId! } })).toMatchObject({ status: 'CAPTURED' });
    expect(await t.ledger.balance(h.walletAccountId!)).toEqual({ posted: 2000, held: 0, available: 2000 });
    expect(await t.ledger.balance(c.walletAccountId)).toEqual({ posted: 500, held: 0, available: 500 });
    expect((await t.ledger.balance(revenue)).posted - revenueBefore).toBe(1500);
    const slot = await t.prisma.requestSlot.findUniqueOrThrow({ where: { id: a.slotId } });
    expect(slot.emergencyCaptured).toBe(true);
    const txs = await t.prisma.ledgerTransaction.findMany({ where: { assignmentId: a.id }, orderBy: { createdAt: 'asc' } });
    expect(txs.map((x) => [x.kind, x.idempotencyKey]).sort()).toEqual([
      ['EMERGENCY_FEE_CAPTURE', `emergency-capture:${slot.id}`],
      ['REQUEST_FEE_CAPTURE', `fee-capture:${a.id}`],
    ]);
    expect(t.realtime.sentTo(rooms.user(h.userId), 'wallet:updated').length).toBeGreaterThan(0);
    // Running the job again changes nothing.
    await t.jobs.runNow('assignment.feeWindowClose', { assignmentId: a.id });
    expect(await t.ledger.balance(h.walletAccountId!)).toEqual({ posted: 2000, held: 0, available: 2000 });
    const view = await t.client(h.token).call(api.pro.offers);
    expect(view.items).toEqual([]);
    await expectLedgerSound(t);
  });

  it('the fees reconciler captures a fee whose timer was lost', async () => {
    const c = await createCustomer(t);
    const h = await soloOnline();
    const req = await createRequest(t, c);
    await t.client(h.token).call(api.pro.acceptOffer, { params: { id: (await offerFor(req.id, h.handymanId)).id } });
    t.jobs.clearManual();
    t.clock.advance(301_000);
    await t.reconciler.tickAll();
    expect((await onlyAssignment(t, req.id)).feeCaptured).toBe(true);
    expect(await t.ledger.balance(h.walletAccountId!)).toMatchObject({ posted: 1000, held: 0 });
    await expectLedgerSound(t);
  });

  it('customer view hides the provider phone until the contact window opens; pro view hides the customer phone likewise', async () => {
    const c = await createCustomer(t);
    const h = await soloOnline();
    const req = await createRequest(t, c);
    await t.client(h.token).call(api.pro.acceptOffer, { params: { id: (await offerFor(req.id, h.handymanId)).id } });
    let detail = await t.client(c.token).call(api.requests.get, { params: { id: req.id } });
    expect(detail.assignments).toHaveLength(1);
    expect(detail.assignments[0]).toMatchObject({ providerPhone: null, contactUnlocked: false, chatEnabled: false, provider: { handymanId: h.handymanId } });
    expect(JSON.stringify(detail)).not.toContain(h.phone);
    const a = await onlyAssignment(t, req.id);
    let pro = await views(t).toProAssignment(a.id, h.userId, 'az');
    expect(pro.customerPhone).toBeNull();

    await t.prisma.assignment.update({ where: { id: a.id }, data: { status: 'EN_ROUTE', etaSec: 240, contactUnlockedAt: t.clock.now() } });
    detail = await t.client(c.token).call(api.requests.get, { params: { id: req.id } });
    expect(detail.assignments[0]).toMatchObject({ providerPhone: h.phone, contactUnlocked: true, chatEnabled: true });
    pro = await views(t).toProAssignment(a.id, h.userId, 'az');
    expect(pro.customerPhone).toBe(c.phone);
  });
});
