import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api } from '@tezfiks/shared';
import { createTestApp, type TestApp } from '../helpers/app';
import { BAKU } from '../helpers/factories';
import { assignmentRow, companyJob, payWithCard, setSettings, soloJob, toArrived, toPriceProposed } from './helpers';

describe('B3 idempotent endpoints and request validation', () => {
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

  it('enterPrice replay with the same key returns the stored result; a new key on PRICE_PROPOSED is INVALID_STATE', async () => {
    const job = await soloJob(t);
    await toArrived(t, job);
    const H = t.client(job.h.token);
    const first = await H.call(api.pro.enterPrice, { params: { id: job.assignmentId }, body: { labor: 2500, materials: 0 }, idempotencyKey: 'price-key-0001' });
    const again = await H.call(api.pro.enterPrice, { params: { id: job.assignmentId }, body: { labor: 2500, materials: 0 }, idempotencyKey: 'price-key-0001' });
    expect(again.price).toEqual(first.price);
    expect(await t.prisma.notification.count({ where: { userId: job.c.userId, type: 'PRICE_PROPOSED' } })).toBe(1);
    await expect(
      H.call(api.pro.enterPrice, { params: { id: job.assignmentId }, body: { labor: 9900, materials: 0 }, idempotencyKey: 'price-key-0002' }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
    // Same key with another body: IDEMPOTENCY_CONFLICT.
    await expect(
      H.call(api.pro.enterPrice, { params: { id: job.assignmentId }, body: { labor: 1, materials: 0 }, idempotencyKey: 'price-key-0001' }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('confirmPrice CARD replay returns the same checkout; tip replay creates one intent', async () => {
    const job = await soloJob(t);
    await toPriceProposed(t, job, 3000, 0);
    const C = t.client(job.c.token);
    const a = await C.call(api.assignments.confirmPrice, { params: { id: job.assignmentId }, body: { method: 'CARD' }, idempotencyKey: 'confirm-0001' });
    const b = await C.call(api.assignments.confirmPrice, { params: { id: job.assignmentId }, body: { method: 'CARD' }, idempotencyKey: 'confirm-0001' });
    expect(b.payment).toEqual(a.payment);
    expect(await t.prisma.paymentIntent.count({ where: { assignmentId: job.assignmentId, purpose: 'JOB_PAYMENT' } })).toBe(1);
    await payWithCard(t, a.payment!.checkoutUrl);
    const tip1 = await C.call(api.assignments.tip, { params: { id: job.assignmentId }, body: { amount: 200 }, idempotencyKey: 'tip-0001' });
    const tip2 = await C.call(api.assignments.tip, { params: { id: job.assignmentId }, body: { amount: 200 }, idempotencyKey: 'tip-0001' });
    expect(tip2).toEqual(tip1);
    expect(await t.prisma.paymentIntent.count({ where: { assignmentId: job.assignmentId, purpose: 'TIP' } })).toBe(1);
  });

  it('body validation: negative prices, stars out of range, empty chat messages, too short dispute reasons', async () => {
    const job = await soloJob(t);
    await toArrived(t, job, BAKU.narimanov);
    const H = t.client(job.h.token);
    await expect(H.call(api.pro.enterPrice, { params: { id: job.assignmentId }, body: { labor: -1, materials: 0 } })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      status: 400,
    });
    await expect(t.client(job.c.token).call(api.chat.send, { params: { id: job.assignmentId }, body: { body: '   ' } })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await H.call(api.pro.enterPrice, { params: { id: job.assignmentId }, body: { labor: 100, materials: 0 } });
    await expect(t.client(job.c.token).call(api.assignments.disputePrice, { params: { id: job.assignmentId }, body: { reason: 'x' } })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await t.client(job.c.token).call(api.assignments.confirmPrice, { params: { id: job.assignmentId }, body: { method: 'CASH' } });
    await expect(t.client(job.c.token).call(api.assignments.rate, { params: { id: job.assignmentId }, body: { stars: 6 } })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect((await assignmentRow(t, job.assignmentId)).customerRatedAt).toBeNull();
  });

  it('company endpoints: unknown company -> NOT_FOUND, non-manager -> NOT_COMPANY_MANAGER', async () => {
    const job = await companyJob(t);
    await expect(
      t.client(job.co.manager.token).call(api.company.assignments, { params: { companyId: '0190a0a0-0000-7000-8000-000000000000' } }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(t.client(job.worker.token).call(api.company.assignments, { params: { companyId: job.co.companyId } })).rejects.toMatchObject({
      code: 'NOT_COMPANY_MANAGER',
      status: 403,
    });
  });
});
