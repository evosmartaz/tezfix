import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api } from '@tezfiks/shared';
import { createTestApp, type TestApp } from '../helpers/app';
import { createCustomer, tokenFor } from '../helpers/factories';
import { upload } from '../b1/helpers';
import { admin, advance, assignmentRow, bal, expectLedgerSound, payWithCard, platform, setSettings, soloJob, toPriceProposed, type SoloJob } from './helpers';

describe('B3 cases: price disputes, guarantee claims, admin decisions', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
    await setSettings(t, { minCandidates: 0, autoCompleteAfterMin: 10 });
  });

  async function disputed(): Promise<SoloJob & { caseId: string }> {
    const job = await soloJob(t, { proBalance: 2000 });
    await advance(t, 301_000); // fee captured
    await toPriceProposed(t, job, 9000, 1000);
    const out = await t.client(job.c.token).call(api.assignments.disputePrice, { params: { id: job.assignmentId }, body: { reason: 'Qiymət çox bahadır, 50 AZN razılaşmışdıq' } });
    expect(out.status).toBe('PRICE_DISPUTED');
    const c = await t.prisma.case.findFirstOrThrow({ where: { assignmentId: job.assignmentId, type: 'PRICE_DISPUTE' } });
    return { ...job, caseId: c.id };
  }

  async function cardPaid(): Promise<SoloJob> {
    const job = await soloJob(t, { proBalance: 2000 });
    await toPriceProposed(t, job, 5000, 0);
    const conf = await t.client(job.c.token).call(api.assignments.confirmPrice, { params: { id: job.assignmentId }, body: { method: 'CARD' } });
    await payWithCard(t, conf.payment!.checkoutUrl);
    expect((await assignmentRow(t, job.assignmentId)).status).toBe('COMPLETED');
    return job;
  }

  it('dispute: PRICE_PROPOSED -> PRICE_DISPUTED + case; auto-complete stops; open card checkout is cancelled; wrong state refused', async () => {
    const job = await soloJob(t);
    await toPriceProposed(t, job);
    const C = t.client(job.c.token);
    const card = await C.call(api.assignments.confirmPrice, { params: { id: job.assignmentId }, body: { method: 'CARD' } });
    t.realtime.clearSent();
    const out = await C.call(api.assignments.disputePrice, { params: { id: job.assignmentId }, body: { reason: 'Qiymət uyğun deyil' } });
    expect(out).toMatchObject({ status: 'PRICE_DISPUTED', actions: { confirmPrice: false, disputePrice: false } });
    expect((await t.prisma.paymentIntent.findUniqueOrThrow({ where: { id: card.payment!.paymentIntentId } })).status).toBe('CANCELLED');
    expect(t.realtime.sentTo('admins', 'admin:event').map((e) => (e.payload as { type: string }).type)).toContain('CASE_OPENED');
    await advance(t, 60 * 60_000);
    await t.reconciler.tickAll();
    expect((await assignmentRow(t, job.assignmentId)).status).toBe('PRICE_DISPUTED');
    const C2 = t.client(await tokenFor(t, job.c.userId, 'CUSTOMER'));
    await expect(C2.call(api.assignments.disputePrice, { params: { id: job.assignmentId }, body: { reason: 'yenə' } })).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
    await expect(C2.call(api.assignments.confirmPrice, { params: { id: job.assignmentId }, body: { method: 'CASH' } })).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
    const mine = await C2.call(api.cases.list);
    expect(mine.items).toHaveLength(1);
    expect(mine.items[0]).toMatchObject({ type: 'PRICE_DISPUTE', status: 'OPEN', assignmentId: job.assignmentId, requestNumber: job.requestNumber, description: 'Qiymət uyğun deyil' });
    // Another customer sees none of it.
    const other = await createCustomer(t);
    expect((await t.client(other.token).call(api.cases.list)).items).toEqual([]);
  });

  it('admin: list, detail with the assignment row, notes (OPEN -> IN_REVIEW), audit; users cannot call admin endpoints', async () => {
    const job = await disputed();
    const { token, adminId } = await admin(t);
    const A = t.client(token);
    const list = await A.call(api.admin.cases, { query: { status: 'OPEN', type: 'PRICE_DISPUTE' } });
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ id: job.caseId, customerName: 'Nizami Talıbov', providerName: 'Elvin Məmmədov', requestNumber: job.requestNumber });
    expect((await A.call(api.admin.cases, { query: { status: 'RESOLVED' } })).items).toEqual([]);
    const d = await A.call(api.admin.case, { params: { id: job.caseId } });
    expect(d.assignment).toMatchObject({ id: job.assignmentId, status: 'PRICE_DISPUTED', providerPhone: job.h.phone, customerPhone: job.c.phone, price: { total: 10000 } });
    const noted = await A.call(api.admin.addCaseNote, { params: { id: job.caseId }, body: { body: 'Müştəri ilə danışıldı' } });
    expect(noted.case.status).toBe('IN_REVIEW');
    expect(noted.notes).toEqual([expect.objectContaining({ authorName: 'Test Admin', body: 'Müştəri ilə danışıldı' })]);
    expect(await t.prisma.auditLog.count({ where: { actorId: adminId, action: 'case.note', entityId: job.caseId } })).toBe(1);
    await expect(t.client(job.c.token).call(api.admin.cases)).rejects.toMatchObject({ status: 403 });
    await expect(A.call(api.admin.case, { params: { id: '0190a0a0-0000-7000-8000-000000000000' } })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('resolve REPROPOSE_PRICE: needs a price, sets it and returns to PRICE_PROPOSED; the customer then pays it', async () => {
    const job = await disputed();
    const { token } = await admin(t);
    const A = t.client(token);
    await expect(A.call(api.admin.resolveCase, { params: { id: job.caseId }, body: { note: 'Düzəliş', outcome: 'REPROPOSE_PRICE' } })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    const d = await A.call(api.admin.resolveCase, {
      params: { id: job.caseId },
      body: { note: 'Razılaşdırılmış qiymət 50 AZN', outcome: 'REPROPOSE_PRICE', price: { labor: 4000, materials: 1000 } },
    });
    expect(d.case).toMatchObject({ status: 'RESOLVED', resolutionNote: 'Razılaşdırılmış qiymət 50 AZN' });
    expect(d.assignment).toMatchObject({ status: 'PRICE_PROPOSED', price: { labor: 4000, materials: 1000, total: 5000 } });
    expect(await t.prisma.notification.count({ where: { userId: job.c.userId, type: 'PRICE_PROPOSED' } })).toBe(2);
    expect(await t.prisma.notification.count({ where: { userId: job.c.userId, type: 'CASE_UPDATED' } })).toBe(1);
    // Decided cases are closed for further decisions.
    await expect(A.call(api.admin.rejectCase, { params: { id: job.caseId }, body: { note: 'x' } })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    // Auto-complete runs again for the new price.
    await advance(t, 10 * 60_000);
    expect(await assignmentRow(t, job.assignmentId)).toMatchObject({ status: 'COMPLETED', paymentMethod: 'CASH', totalAmount: 5000n });
    await expectLedgerSound(t);
  });

  it('resolve COMPLETE_CASH completes the job; CANCEL_ASSIGNMENT cancels without fees (provider fee refunded); reject keeps the proposed price', async () => {
    const a = await disputed();
    const { token } = await admin(t);
    const A = t.client(token);
    const d = await A.call(api.admin.resolveCase, { params: { id: a.caseId }, body: { note: 'Nağd ödənilib', outcome: 'COMPLETE_CASH' } });
    expect(d.assignment).toMatchObject({ status: 'COMPLETED', paymentMethod: 'CASH' });
    expect((await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: a.requestId } })).status).toBe('COMPLETED');

    await t.reset();
    await setSettings(t, { minCandidates: 0, autoCompleteAfterMin: 10 });
    const b = await disputed();
    const A2 = t.client((await admin(t)).token);
    expect(await bal(t, b.h.walletAccountId!)).toEqual({ posted: 1000, held: 0, available: 1000 });
    const revenue0 = await platform(t, 'REVENUE');
    const d2 = await A2.call(api.admin.resolveCase, { params: { id: b.caseId }, body: { note: 'İş görülməyib', outcome: 'CANCEL_ASSIGNMENT' } });
    expect(d2.assignment).toMatchObject({ status: 'CANCELLED_FREE', cancelledBy: 'ADMIN' });
    expect(await bal(t, b.h.walletAccountId!)).toEqual({ posted: 2000, held: 0, available: 2000 });
    expect(await bal(t, b.c.walletAccountId)).toMatchObject({ posted: 0 });
    expect((await platform(t, 'REVENUE')) - revenue0).toBe(-1000);
    expect((await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: b.requestId } })).status).toBe('CANCELLED');
    await expectLedgerSound(t);

    await t.reset();
    await setSettings(t, { minCandidates: 0, autoCompleteAfterMin: 10 });
    const c = await disputed();
    const A3 = t.client((await admin(t)).token);
    const d3 = await A3.call(api.admin.rejectCase, { params: { id: c.caseId }, body: { note: 'Qiymət əsaslıdır' } });
    expect(d3.case.status).toBe('REJECTED');
    expect(d3.assignment).toMatchObject({ status: 'PRICE_PROPOSED', price: { total: 10000 } });
    await t.client(c.c.token).call(api.assignments.confirmPrice, { params: { id: c.assignmentId }, body: { method: 'CASH' } });
    // Outcomes other than RESOLVED are for price disputes only; redispatch only for guarantee claims.
    await expect(A3.call(api.admin.redispatchCase, { params: { id: c.caseId }, body: {} })).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('guarantee: only card-paid jobs within guaranteeUntil; claim -> admin re-dispatch -> fee-free request offered first to the original pro', async () => {
    // Cash jobs have no guarantee.
    const cash = await soloJob(t);
    await toPriceProposed(t, cash);
    await t.client(cash.c.token).call(api.assignments.confirmPrice, { params: { id: cash.assignmentId }, body: { method: 'CASH' } });
    await expect(
      t.client(cash.c.token).call(api.assignments.guaranteeClaim, { params: { id: cash.assignmentId }, body: { description: 'Kran yenə axır' } }),
    ).rejects.toMatchObject({ code: 'GUARANTEE_NOT_AVAILABLE', status: 409 });

    await t.reset();
    await setSettings(t, { minCandidates: 0, autoCompleteAfterMin: 10 });
    const job = await cardPaid();
    const C = t.client(job.c.token);
    const photo = await upload(t, job.c.token, 'CASE_PHOTO');
    const foreign = await upload(t, job.h.token, 'CASE_PHOTO');
    await expect(
      C.call(api.assignments.guaranteeClaim, { params: { id: job.assignmentId }, body: { description: 'Kran yenə axır', photoFileIds: [foreign.id] } }),
    ).rejects.toMatchObject({ code: 'FILE_NOT_OWNED' });
    const cv = await C.call(api.assignments.guaranteeClaim, {
      params: { id: job.assignmentId },
      body: { description: 'Kran yenə axır, iki gündür', photoFileIds: [photo.id] },
    });
    expect(cv).toMatchObject({ type: 'GUARANTEE', status: 'OPEN', requestNumber: job.requestNumber, photos: [expect.objectContaining({ id: photo.id })] });
    await expect(C.call(api.assignments.guaranteeClaim, { params: { id: job.assignmentId }, body: { description: 'yenə də' } })).rejects.toMatchObject({
      code: 'CONFLICT',
    });

    const { token, adminId } = await admin(t);
    const A = t.client(token);
    await expect(
      A.call(api.admin.resolveCase, { params: { id: cv.id }, body: { note: 'x', outcome: 'COMPLETE_CASH' } }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const wallet0 = await bal(t, job.h.walletAccountId!);
    const d = await A.call(api.admin.redispatchCase, { params: { id: cv.id }, body: { note: 'Ustaya yenidən göndərildi' } });
    expect(d.case.status).toBe('REDISPATCHED');
    const fixId = d.case.followUpRequestId!;
    const fix = await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: fixId } });
    expect(fix).toMatchObject({ isGuaranteeFix: true, originAssignmentId: job.assignmentId, preferredHandymanId: job.h.handymanId, status: 'SEARCHING' });
    // Offered first (and only) to the original pro.
    const offers = await t.prisma.offer.findMany({ where: { requestId: fixId } });
    expect(offers.map((o) => o.handymanId)).toEqual([job.h.handymanId]);
    expect(await t.prisma.auditLog.count({ where: { actorId: adminId, action: 'case.redispatch' } })).toBe(1);
    expect(d.notes.map((n) => n.body)).toEqual(['Ustaya yenidən göndərildi']);
    await expect(A.call(api.admin.redispatchCase, { params: { id: cv.id }, body: {} })).rejects.toMatchObject({ code: 'INVALID_STATE' });

    // The original pro accepts: no fee hold; the price is fixed at 0 and completes without payment.
    const H = t.client(await tokenFor(t, job.h.userId, 'PRO'));
    const acc = await H.call(api.pro.acceptOffer, { params: { id: offers[0]!.id } });
    expect(acc.assignment).toMatchObject({ isGuaranteeFix: true, fee: { amount: 0 } });
    expect(await bal(t, job.h.walletAccountId!)).toEqual(wallet0);
    const fixA = acc.assignment.id;
    await H.call(api.pro.enRoute, { params: { id: fixA }, body: {} });
    await H.call(api.pro.arrived, { params: { id: fixA } });
    const priced = await H.call(api.pro.enterPrice, { params: { id: fixA }, body: { labor: 3000, materials: 500 } });
    expect(priced.price).toEqual({ labor: 0, materials: 0, total: 0 });
    const C2 = t.client(await tokenFor(t, job.c.userId, 'CUSTOMER'));
    const done = await C2.call(api.assignments.confirmPrice, { params: { id: fixA }, body: { method: 'CARD' } });
    expect(done).toMatchObject({ payment: null, assignment: { status: 'COMPLETED' } });
    expect(await bal(t, job.h.walletAccountId!)).toEqual(wallet0);
    await expectLedgerSound(t);
  });

  it('guarantee expires after guaranteeDays', async () => {
    const job = await cardPaid();
    t.clock.advance(14 * 86_400_000 + 1_000);
    const C = t.client(await tokenFor(t, job.c.userId, 'CUSTOMER'));
    await expect(C.call(api.assignments.guaranteeClaim, { params: { id: job.assignmentId }, body: { description: 'Gec müraciət' } })).rejects.toMatchObject({
      code: 'GUARANTEE_NOT_AVAILABLE',
    });
    const view = await C.call(api.assignments.get, { params: { id: job.assignmentId } });
    expect(view.actions.guaranteeClaim).toBe(false);
  });
});
