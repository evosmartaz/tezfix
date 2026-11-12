import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api } from '@tezfiks/shared';
import { createTestApp, type TestApp } from '../helpers/app';
import { BAKU, adminToken, createCustomer, createSoloHandyman } from '../helpers/factories';
import {
  adminEvents,
  advance,
  assignmentRow,
  auditOf,
  bal,
  companyJob,
  createRequest,
  expectDomainRejections,
  expectLedgerSound,
  goOnline,
  placeAt,
  platform,
  seedRequest,
  setSettings,
  soloJob,
  toArrived,
  toPriceProposed,
} from './helpers';

const ROUNDS = 4;

describe('B5 admin force-cancel of a request (CancellationService, actor ADMIN)', () => {
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

  async function fresh() {
    await t.reset();
    await setSettings(t, { minCandidates: 0 });
  }

  it('a searching emergency request: cancelled, offers closed, emergency hold released, search stopped, customer notified, audited', async () => {
    const c = await createCustomer(t, { balance: 5000 });
    const h = await createSoloHandyman(t, { balance: 2000 });
    await goOnline(t, h.handymanId, BAKU.center);
    const req = await createRequest(t, c, { timing: 'EMERGENCY' });
    expect(await bal(t, c.walletAccountId)).toMatchObject({ posted: 5000, held: 500 });
    expect(await t.prisma.offer.count({ where: { requestId: req.id, status: 'SENT' } })).toBe(1);
    const op = await adminToken(t, { role: 'OPERATOR' });

    const d = await t.client(op.token).call(api.admin.cancelRequest, {
      params: { id: req.id },
      body: { reason: 'Müştəri zəng edib ləğv etdi' },
    });
    expect(d.request).toMatchObject({ status: 'CANCELLED', isSearching: false, cancelReason: 'Müştəri zəng edib ləğv etdi', canCancel: false });
    expect(d.request.cancelledAt).not.toBeNull();
    expect(d.offers.every((o) => o.status === 'CLOSED')).toBe(true);
    expect(d.timeline.find((e) => e.event === 'cancelled')).toMatchObject({ actor: 'Admin' });
    const row = await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: req.id }, include: { slots: true, offers: true } });
    expect(row).toMatchObject({ status: 'CANCELLED', cancelledBy: 'ADMIN', isSearching: false });
    expect(row.slots.every((s) => s.status === 'CANCELLED')).toBe(true);
    expect(row.offers[0]).toMatchObject({ status: 'CLOSED', closeReason: 'CANCELLED' });
    expect(await bal(t, c.walletAccountId)).toEqual({ posted: 5000, held: 0, available: 5000 });
    expect(t.realtime.sentTo(`user:${h.userId}`, 'offer:closed')).not.toHaveLength(0);

    const notes = await t.prisma.notification.findMany({ where: { userId: c.userId, type: 'REQUEST_CANCELLED' } });
    expect(notes).toHaveLength(1);
    expect(notes[0]!.body).toContain(String(req.number));

    const audit = await auditOf(t, 'ServiceRequest', req.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'request.cancel',
      actorType: 'ADMIN',
      actorId: op.adminId,
      before: { status: 'SEARCHING', isSearching: true, assignments: [] },
      after: { status: 'CANCELLED', isSearching: false, assignments: [], reason: 'Müştəri zəng edib ləğv etdi', chargeCustomer: false, customerPenalty: 0 },
    });
    expect(adminEvents(t)).toContainEqual({ type: 'REQUEST_CANCELLED', entityId: req.id });

    // The search does not continue after the cancel.
    await advance(t, 600_000);
    expect(await t.prisma.offer.count({ where: { requestId: req.id } })).toBe(1);
    expect((await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe('CANCELLED');

    // Already terminal now.
    await expect(t.client(op.token).call(api.admin.cancelRequest, { params: { id: req.id }, body: { reason: 'yenidən' } })).rejects.toMatchObject({
      code: 'INVALID_STATE',
      status: 409,
    });
    expect(await auditOf(t, 'ServiceRequest', req.id)).toHaveLength(1);
    await expectLedgerSound(t);
  });

  it('an accepted job inside the free window: fee hold released, no strike, no penalty, both sides notified', async () => {
    const job = await soloJob(t, { proBalance: 2000 });
    expect(await bal(t, job.h.walletAccountId!)).toMatchObject({ held: 1000 });
    const { token, adminId } = await adminToken(t);
    const d = await t.client(token).call(api.admin.cancelRequest, { params: { id: job.requestId }, body: { reason: 'Saxta sifariş' } });
    expect(d.request.status).toBe('CANCELLED');
    expect(d.assignments[0]).toMatchObject({ status: 'CANCELLED_FREE', cancelledBy: 'ADMIN', fee: { amount: 1000, captured: false, refunded: false } });
    expect(await bal(t, job.h.walletAccountId!)).toEqual({ posted: 2000, held: 0, available: 2000 });
    expect(await bal(t, job.c.walletAccountId)).toEqual({ posted: 0, held: 0, available: 0 });
    const prof = await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: job.h.handymanId } });
    expect(prof.strikes).toBe(0);
    expect(await t.prisma.strikeEvent.count()).toBe(0);
    const a = await assignmentRow(t, job.assignmentId);
    expect(a).toMatchObject({ cancelReason: 'Saxta sifariş', cancelledBy: 'ADMIN' });
    expect(await t.prisma.notification.count({ where: { userId: job.c.userId, type: 'ASSIGNMENT_CANCELLED' } })).toBe(1);
    expect(await t.prisma.notification.count({ where: { userId: job.h.userId, type: 'ASSIGNMENT_CANCELLED' } })).toBe(1);
    // Assignment cancellations notify the customer themselves; no extra REQUEST_CANCELLED.
    expect(await t.prisma.notification.count({ where: { userId: job.c.userId, type: 'REQUEST_CANCELLED' } })).toBe(0);
    const ledgerActors = await t.prisma.ledgerTransaction.findMany({ where: { requestId: job.requestId } });
    expect(ledgerActors.every((x) => x.kind !== 'REQUEST_FEE_CAPTURE')).toBe(true);
    // The fee window job later finds nothing to capture.
    await advance(t, 400_000);
    expect(await bal(t, job.h.walletAccountId!)).toEqual({ posted: 2000, held: 0, available: 2000 });
    expect((await auditOf(t, 'ServiceRequest', job.requestId))[0]).toMatchObject({
      actorId: adminId,
      before: { status: 'ASSIGNED', assignments: [{ id: job.assignmentId, status: 'ACCEPTED' }] },
      after: { status: 'CANCELLED', assignments: [{ id: job.assignmentId, status: 'CANCELLED_FREE' }] },
    });
    await expectLedgerSound(t);
  });

  it('after the fee was captured (en route): the fee is refunded to the pro, platform keeps nothing', async () => {
    const job = await soloJob(t, { proBalance: 2000 });
    await advance(t, 301_000);
    await t.client(job.h.token).call(api.pro.enRoute, { params: { id: job.assignmentId }, body: { location: BAKU.narimanov } });
    expect(await bal(t, job.h.walletAccountId!)).toMatchObject({ posted: 1000, held: 0 });
    expect(await platform(t, 'REVENUE')).toBe(1000);
    const { token } = await adminToken(t);
    const d = await t.client(token).call(api.admin.cancelRequest, { params: { id: job.requestId }, body: { reason: 'Usta gecikir' } });
    expect(d.assignments[0]).toMatchObject({ status: 'CANCELLED_FREE', fee: { amount: 1000, captured: true, refunded: true } });
    expect(await bal(t, job.h.walletAccountId!)).toEqual({ posted: 2000, held: 0, available: 2000 });
    expect(await platform(t, 'REVENUE')).toBe(0);
    expect(d.timeline.map((e) => e.event)).toEqual(expect.arrayContaining(['fee.captured', 'fee.refunded', 'cancelled']));
    expect((await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: job.h.handymanId } })).strikes).toBe(0);
    const row = (await t.client(token).call(api.admin.requests)).items[0]!;
    expect(row).toMatchObject({ status: 'CANCELLED', fee: 0 });
    await expectLedgerSound(t);
  });

  it('chargeCustomer at arrival: the customer pays the penalty (debt allowed), the pro gets the fee back and the compensation', async () => {
    const job = await soloJob(t, { proBalance: 2000, customerBalance: 0 });
    await advance(t, 301_000);
    await toArrived(t, job);
    const { token } = await adminToken(t);
    const d = await t.client(token).call(api.admin.cancelRequest, {
      params: { id: job.requestId },
      body: { reason: 'Müştəri qapını açmadı', chargeCustomer: true },
    });
    expect(d.assignments[0]).toMatchObject({ status: 'CANCELLED_BY_CUSTOMER', cancelledBy: 'ADMIN' });
    expect(await bal(t, job.c.walletAccountId)).toMatchObject({ posted: -1500 });
    expect(await bal(t, job.h.walletAccountId!)).toMatchObject({ posted: 3000, held: 0 });
    expect(await platform(t, 'REVENUE')).toBe(1500);
    expect(await platform(t, 'PROMO')).toBe(-1000);
    expect(d.timeline.map((e) => e.event)).toContain('penalty');
    expect((await auditOf(t, 'ServiceRequest', job.requestId))[0]!.after).toMatchObject({ chargeCustomer: true, customerPenalty: 1500 });
    expect((await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: job.h.handymanId } })).strikes).toBe(0);
    const cust = await t.client(token).call(api.admin.customer, { params: { id: job.c.accountId } });
    expect(cust.row.walletBalance).toBe(-1500);
    await expectLedgerSound(t);
  });

  it('a proposed price can still be force-cancelled (no fees kept)', async () => {
    const job = await soloJob(t, { proBalance: 2000 });
    await advance(t, 301_000);
    await toPriceProposed(t, job);
    const { token } = await adminToken(t);
    const d = await t.client(token).call(api.admin.cancelRequest, { params: { id: job.requestId }, body: { reason: 'Qiymət mübahisəsi' } });
    expect(d.request.status).toBe('CANCELLED');
    expect(d.assignments[0]!.status).toBe('CANCELLED_FREE');
    expect(await bal(t, job.h.walletAccountId!)).toMatchObject({ posted: 2000, held: 0 });
    await expectLedgerSound(t);
  });

  it('a proposed price with an open card checkout: the checkout is cancelled and the cash auto-completion never fires', async () => {
    const job = await soloJob(t, { proBalance: 2000 });
    await advance(t, 301_000);
    await toPriceProposed(t, job);
    const conf = await t.client(job.c.token).call(api.assignments.confirmPrice, { params: { id: job.assignmentId }, body: { method: 'CARD' } });
    const intentId = conf.payment!.paymentIntentId;
    expect((await t.prisma.paymentIntent.findUniqueOrThrow({ where: { id: intentId } })).status).toBe('CREATED');
    const { token } = await adminToken(t);
    await t.client(token).call(api.admin.cancelRequest, { params: { id: job.requestId }, body: { reason: 'Müştəri imtina etdi' } });
    expect((await t.prisma.paymentIntent.findUniqueOrThrow({ where: { id: intentId } })).status).toBe('CANCELLED');
    const proEarnings = job.h.earningsAccountId!;
    await advance(t, 3 * 3_600_000);
    await t.reconciler.tickAll();
    const a = await assignmentRow(t, job.assignmentId);
    expect(a).toMatchObject({ status: 'CANCELLED_FREE', cancelledBy: 'ADMIN', completedAt: null, paymentMethod: null });
    expect(await bal(t, proEarnings)).toMatchObject({ posted: 0 });
    expect(await bal(t, job.h.walletAccountId!)).toMatchObject({ posted: 2000, held: 0 });
    await expectLedgerSound(t);
  });

  it('a disputed price: the job is cancelled for free and its open PRICE_DISPUTE case is closed (resolved, audited, opener told)', async () => {
    const job = await soloJob(t, { proBalance: 2000 });
    await advance(t, 301_000);
    await toPriceProposed(t, job);
    await t.client(job.c.token).call(api.assignments.disputePrice, { params: { id: job.assignmentId }, body: { reason: 'Qiymət çox bahadır' } });
    const opened = await t.prisma.case.findFirstOrThrow({ where: { assignmentId: job.assignmentId, type: 'PRICE_DISPUTE' } });
    expect(opened.status).toBe('OPEN');
    const { token, adminId } = await adminToken(t);
    const A = t.client(token, 'en');
    expect((await A.call(api.admin.dashboard)).openCases).toBe(1);
    expect(await t.prisma.notification.count({ where: { userId: job.c.userId, type: 'CASE_UPDATED' } })).toBe(0);

    const d = await A.call(api.admin.cancelRequest, { params: { id: job.requestId }, body: { reason: 'Mübahisə ləğvlə bağlandı' } });
    expect(d.request.status).toBe('CANCELLED');
    expect(d.assignments[0]).toMatchObject({ status: 'CANCELLED_FREE', cancelledBy: 'ADMIN', fee: { amount: 1000, captured: true, refunded: true } });
    expect(await bal(t, job.h.walletAccountId!)).toEqual({ posted: 2000, held: 0, available: 2000 });
    expect(await bal(t, job.c.walletAccountId)).toEqual({ posted: 0, held: 0, available: 0 });
    expect(await platform(t, 'REVENUE')).toBe(0);

    const closedCase = await t.prisma.case.findUniqueOrThrow({ where: { id: opened.id } });
    expect(closedCase).toMatchObject({ status: 'RESOLVED', resolutionNote: 'Mübahisə ləğvlə bağlandı', resolvedByAdminId: adminId });
    const caseAudit = await auditOf(t, 'Case', opened.id);
    expect(caseAudit).toHaveLength(1);
    expect(caseAudit[0]).toMatchObject({
      action: 'case.resolve',
      actorType: 'ADMIN',
      actorId: adminId,
      before: { status: 'OPEN' },
      after: { status: 'RESOLVED', outcome: 'CANCEL_ASSIGNMENT', via: 'request.cancel', requestId: job.requestId },
    });
    expect((await auditOf(t, 'ServiceRequest', job.requestId))[0]!.after).toMatchObject({ closedCases: [opened.id] });
    expect(await t.prisma.notification.count({ where: { userId: job.c.userId, type: 'CASE_UPDATED' } })).toBe(1);
    expect(adminEvents(t)).toContainEqual({ type: 'CASE_RESOLVED', entityId: opened.id });
    expect((await A.call(api.admin.dashboard)).openCases).toBe(0);
    const c = await A.call(api.admin.case, { params: { id: opened.id } });
    expect(c.case.status).toBe('RESOLVED');

    // B3's case decisions no longer apply to the closed case.
    await expect(A.call(api.admin.resolveCase, { params: { id: opened.id }, body: { note: 'Nağd', outcome: 'COMPLETE_CASH' } })).rejects.toMatchObject({
      code: 'INVALID_STATE',
      status: 409,
    });
    await expect(A.call(api.admin.rejectCase, { params: { id: opened.id }, body: { note: 'Rədd' } })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect((await assignmentRow(t, job.assignmentId)).status).toBe('CANCELLED_FREE');

    // The timeline shows the dispute and a single cancellation by the admin.
    const events = d.timeline.map((e) => e.event);
    expect(events).toContain('price_disputed');
    expect(events.filter((e) => e === 'cancelled')).toHaveLength(1);
    expect(d.timeline.find((e) => e.event === 'cancelled')).toMatchObject({ actor: 'Admin', details: 'Cancelled by an admin: Mübahisə ləğvlə bağlandı' });
    await expectLedgerSound(t);
  });

  it('race: admin cancel vs an admin resolving the price dispute as cash -> exactly one decision wins, no 500', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await fresh();
      const job = await soloJob(t, { proBalance: 2000 });
      await advance(t, 301_000);
      await toPriceProposed(t, job);
      await t.client(job.c.token).call(api.assignments.disputePrice, { params: { id: job.assignmentId }, body: { reason: 'Qiymət uyğun deyil' } });
      const kase = await t.prisma.case.findFirstOrThrow({ where: { assignmentId: job.assignmentId } });
      const a1 = await adminToken(t);
      const a2 = await adminToken(t);
      const [cancel, resolve] = await Promise.allSettled([
        t.client(a1.token).call(api.admin.cancelRequest, { params: { id: job.requestId }, body: { reason: 'Yarış testi' } }),
        t.client(a2.token).call(api.admin.resolveCase, { params: { id: kase.id }, body: { note: 'Nağd ödənilib', outcome: 'COMPLETE_CASH' } }),
      ]);
      expectDomainRejections([cancel, resolve], ['INVALID_STATE', 'CONFLICT']);
      expect([cancel, resolve].filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const a = await assignmentRow(t, job.assignmentId);
      const r = await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: job.requestId } });
      expect((await t.prisma.case.findUniqueOrThrow({ where: { id: kase.id } })).status).toBe('RESOLVED');
      if (cancel.status === 'fulfilled') {
        expect(a.status).toBe('CANCELLED_FREE');
        expect(r.status).toBe('CANCELLED');
        expect(await bal(t, job.h.walletAccountId!)).toMatchObject({ posted: 2000, held: 0 });
      } else {
        expect(a).toMatchObject({ status: 'COMPLETED', paymentMethod: 'CASH' });
        expect(r.status).toBe('COMPLETED');
        expect(await bal(t, job.h.walletAccountId!)).toMatchObject({ posted: 1000, held: 0 });
      }
      expect(await t.prisma.auditLog.count({ where: { entityType: 'Case', entityId: kase.id, action: 'case.resolve' } })).toBe(1);
      await expectLedgerSound(t);
    }
  });

  it('chargeCustomer on a company job: the company wallet gets the fee back and the compensation; the worker gets nothing; no strike', async () => {
    const job = await companyJob(t, { balance: 5000, customerBalance: 0 });
    await advance(t, 301_000);
    expect(await bal(t, job.co.walletAccountId)).toMatchObject({ posted: 4000, held: 0 });
    const W = t.client(job.worker.token);
    await W.call(api.pro.enRoute, { params: { id: job.assignmentId }, body: { location: BAKU.narimanov } });
    await placeAt(t, job.worker.handymanId, BAKU.center); // at the door (arrival needs the server-side position there)
    await W.call(api.pro.arrived, { params: { id: job.assignmentId } });
    const workerWallet = (await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: job.worker.handymanId } })).walletAccountId;
    const workerBefore = workerWallet ? await bal(t, workerWallet) : null;
    const { token } = await adminToken(t);
    const d = await t.client(token).call(api.admin.cancelRequest, {
      params: { id: job.requestId },
      body: { reason: 'Müştəri qapını açmadı', chargeCustomer: true },
    });
    expect(d.request.status).toBe('CANCELLED');
    expect(d.assignments[0]).toMatchObject({
      status: 'CANCELLED_BY_CUSTOMER',
      cancelledBy: 'ADMIN',
      providerType: 'COMPANY',
      companyName: 'FixPro MMC',
      fee: { amount: 1000, captured: true, refunded: true },
    });
    expect(await bal(t, job.c.walletAccountId)).toMatchObject({ posted: -1500 });
    // 5000 - 1000 fee + 1000 fee refund + 1000 compensation.
    expect(await bal(t, job.co.walletAccountId)).toEqual({ posted: 6000, held: 0, available: 6000 });
    if (workerWallet) expect(await bal(t, workerWallet)).toEqual(workerBefore);
    expect(await platform(t, 'REVENUE')).toBe(1500);
    expect(await platform(t, 'PROMO')).toBe(-1000);
    const comp = await t.prisma.ledgerTransaction.findFirstOrThrow({ where: { kind: 'PENALTY_COMPENSATION', requestId: job.requestId }, include: { entries: true } });
    expect(comp.entries.find((e) => e.amount > 0n)!.accountId).toBe(job.co.walletAccountId);
    expect(d.timeline.map((e) => e.event)).toContain('penalty');
    expect((await t.prisma.company.findUniqueOrThrow({ where: { id: job.co.companyId } })).strikes).toBe(0);
    expect((await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: job.worker.handymanId } })).strikes).toBe(0);
    expect(await t.prisma.strikeEvent.count()).toBe(0);
    expect((await auditOf(t, 'ServiceRequest', job.requestId))[0]!.after).toMatchObject({ chargeCustomer: true, customerPenalty: 1500 });
    expect(await t.prisma.notification.count({ where: { userId: job.co.manager.userId, type: 'ASSIGNMENT_CANCELLED' } })).toBe(1);
    await expectLedgerSound(t);
  });

  it('a two-slot request with one job completed: the other job is cancelled and the request ends COMPLETED', async () => {
    const c = await createCustomer(t);
    const h1 = await createSoloHandyman(t, { balance: 2000, firstName: 'Elvin' });
    const h2 = await createSoloHandyman(t, { balance: 2000, firstName: 'Samir', lastName: 'Quliyev' });
    await goOnline(t, h1.handymanId, BAKU.center);
    await goOnline(t, h2.handymanId, BAKU.center);
    const req = await createRequest(t, c, { slots: 2 });
    const offers = await t.prisma.offer.findMany({ where: { requestId: req.id } });
    const o1 = offers.find((o) => o.handymanId === h1.handymanId)!;
    const o2 = offers.find((o) => o.handymanId === h2.handymanId)!;
    const a1 = (await t.client(h1.token).call(api.pro.acceptOffer, { params: { id: o1.id } })).assignment.id;
    const a2 = (await t.client(h2.token).call(api.pro.acceptOffer, { params: { id: o2.id } })).assignment.id;
    await advance(t, 301_000);
    await t.client(h1.token).call(api.pro.enRoute, { params: { id: a1 }, body: { location: BAKU.narimanov } });
    await placeAt(t, h1.handymanId, BAKU.center); // at the door (arrival needs the server-side position there)
    await t.client(h1.token).call(api.pro.arrived, { params: { id: a1 } });
    await t.client(h1.token).call(api.pro.enterPrice, { params: { id: a1 }, body: { labor: 3000, materials: 0 } });
    await t.client(c.token).call(api.assignments.confirmPrice, { params: { id: a1 }, body: { method: 'CASH' } });
    const { token } = await adminToken(t);
    const d = await t.client(token).call(api.admin.cancelRequest, { params: { id: req.id }, body: { reason: 'İkinci usta lazım deyil' } });
    expect(d.request.status).toBe('COMPLETED');
    expect(d.assignments.find((a) => a.id === a1)!.status).toBe('COMPLETED');
    expect(d.assignments.find((a) => a.id === a2)!.status).toBe('CANCELLED_FREE');
    expect(await bal(t, h1.walletAccountId!)).toMatchObject({ posted: 1000 });
    expect(await bal(t, h2.walletAccountId!)).toMatchObject({ posted: 2000, held: 0 });
    await expectLedgerSound(t);
  });

  it('errors: unknown request NOT_FOUND, terminal request INVALID_STATE, short reason VALIDATION_FAILED, users FORBIDDEN', async () => {
    const { token } = await adminToken(t);
    const A = t.client(token);
    await expect(A.call(api.admin.cancelRequest, { params: { id: '0192f000-0000-7000-8000-000000000002' }, body: { reason: 'yoxdur' } })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
    const c = await createCustomer(t);
    for (const status of ['EXPIRED', 'COMPLETED', 'CANCELLED'] as const) {
      const r = await seedRequest(t, c, { createdAt: t.clock.now(), status });
      await expect(A.call(api.admin.cancelRequest, { params: { id: r.id }, body: { reason: 'artıq bitib' } })).rejects.toMatchObject({
        code: 'INVALID_STATE',
        status: 409,
      });
      expect(await auditOf(t, 'ServiceRequest', r.id)).toHaveLength(0);
    }
    const open = await seedRequest(t, c, { createdAt: t.clock.now(), status: 'SEARCHING' });
    await expect(A.call(api.admin.cancelRequest, { params: { id: open.id }, body: { reason: 'ab' } })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(t.client(c.token).call(api.admin.cancelRequest, { params: { id: open.id }, body: { reason: 'özüm ləğv edirəm' } })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });
    expect((await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: open.id } })).status).toBe('SEARCHING');
  });

  it('race: admin cancel vs the pro accepting the offer -> the request always ends cancelled, any accepted job is cancelled for free, no 500', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await fresh();
      const c = await createCustomer(t);
      const h = await createSoloHandyman(t, { balance: 2000 });
      await goOnline(t, h.handymanId, BAKU.center);
      const req = await createRequest(t, c);
      const offer = await t.prisma.offer.findFirstOrThrow({ where: { requestId: req.id, handymanId: h.handymanId } });
      const { token } = await adminToken(t);
      const [cancel, accept] = await Promise.allSettled([
        t.client(token).call(api.admin.cancelRequest, { params: { id: req.id }, body: { reason: 'Yarış testi' } }),
        t.client(h.token).call(api.pro.acceptOffer, { params: { id: offer.id } }),
      ]);
      expectDomainRejections([cancel, accept], ['OFFER_UNAVAILABLE', 'OFFER_EXPIRED', 'INVALID_STATE', 'CONFLICT']);
      expect(cancel.status).toBe('fulfilled');
      const r = await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: req.id }, include: { assignments: true } });
      expect(r.status).toBe('CANCELLED');
      expect(r.isSearching).toBe(false);
      if (accept.status === 'fulfilled') {
        expect(r.assignments).toHaveLength(1);
        expect(r.assignments[0]).toMatchObject({ status: 'CANCELLED_FREE', cancelledBy: 'ADMIN' });
      } else {
        expect(r.assignments).toHaveLength(0);
      }
      expect(await bal(t, h.walletAccountId!)).toEqual({ posted: 2000, held: 0, available: 2000 });
      expect(await t.prisma.hold.count({ where: { status: 'ACTIVE' } })).toBe(0);
      await expectLedgerSound(t);
    }
  });

  it('race: admin cancel vs "en route" -> one consistent outcome (cancelled, fee given back), no 500', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await fresh();
      const job = await soloJob(t, { proBalance: 2000 });
      if (round % 2 === 1) await advance(t, 301_000); // half the rounds with the fee already captured
      const { token } = await adminToken(t);
      const [cancel, enRoute] = await Promise.allSettled([
        t.client(token).call(api.admin.cancelRequest, { params: { id: job.requestId }, body: { reason: 'Yarış testi' } }),
        t.client(job.h.token).call(api.pro.enRoute, { params: { id: job.assignmentId }, body: { location: BAKU.narimanov } }),
      ]);
      expectDomainRejections([cancel, enRoute], ['INVALID_STATE', 'CONFLICT']);
      expect(cancel.status).toBe('fulfilled');
      const a = await assignmentRow(t, job.assignmentId);
      expect(a).toMatchObject({ status: 'CANCELLED_FREE', cancelledBy: 'ADMIN' });
      if (enRoute.status === 'fulfilled') expect(a.enRouteAt).not.toBeNull();
      else expect(a.enRouteAt).toBeNull();
      expect((await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: job.requestId } })).status).toBe('CANCELLED');
      expect(await bal(t, job.h.walletAccountId!)).toEqual({ posted: 2000, held: 0, available: 2000 });
      expect(await platform(t, 'REVENUE')).toBe(0);
      await expectLedgerSound(t);
    }
  });

  it('race: two admins cancelling the same request at once -> exactly one cancel, one INVALID_STATE, one audit row', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await fresh();
      const job = await soloJob(t, { proBalance: 2000 });
      const a1 = await adminToken(t);
      const a2 = await adminToken(t, { role: 'OPERATOR' });
      const results = await Promise.allSettled([
        t.client(a1.token).call(api.admin.cancelRequest, { params: { id: job.requestId }, body: { reason: 'Birinci admin' } }),
        t.client(a2.token).call(api.admin.cancelRequest, { params: { id: job.requestId }, body: { reason: 'İkinci admin', chargeCustomer: true } }),
      ]);
      expectDomainRejections(results, ['INVALID_STATE', 'CONFLICT']);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await auditOf(t, 'ServiceRequest', job.requestId)).toHaveLength(1);
      expect(await t.prisma.ledgerTransaction.count({ where: { kind: 'CANCEL_PENALTY' } })).toBeLessThanOrEqual(1);
      await expectLedgerSound(t);
    }
  });
});
