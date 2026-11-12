import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api } from '@tezfiks/shared';
import { createTestApp, type TestApp } from '../helpers/app';
import { BAKU } from '../helpers/factories';
import { PaymentsService } from '../../src/modules/payments/payments.service';
import { advance, assignmentRow, bal, expectDomainRejections, expectLedgerSound, placeAt, platform, setSettings, soloJob, toArrived, toPriceProposed } from './helpers';

const ROUNDS = 4;

/** B1 lock order (user -> request -> assignment) in every B3 path: concurrent actions end in one consistent outcome, never a 500. */
describe('B3 concurrency: customer cancel vs provider actions, confirm vs auto-complete, double submits', () => {
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

  async function fresh(patch: Record<string, number> = {}) {
    await t.reset();
    await setSettings(t, { minCandidates: 0, ...patch });
  }

  it('late customer cancel racing "arrived": exactly one wins (cancelled + penalty, or arrived and the cancel refused)', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await fresh();
      const job = await soloJob(t, { proBalance: 2000 });
      await advance(t, 301_000);
      await t.client(job.h.token).call(api.pro.enRoute, { params: { id: job.assignmentId }, body: { location: BAKU.narimanov } });
      await placeAt(t, job.h.handymanId, BAKU.center); // at the door (arrival needs the server-side position there)
      const [cancel, arrived] = await Promise.allSettled([
        t.client(job.c.token).call(api.assignments.cancel, { params: { id: job.assignmentId }, body: {} }),
        t.client(job.h.token).call(api.pro.arrived, { params: { id: job.assignmentId } }),
      ]);
      expectDomainRejections([cancel, arrived], ['INVALID_STATE', 'CANCEL_NOT_ALLOWED']);
      const a = await assignmentRow(t, job.assignmentId);
      if (cancel.status === 'fulfilled') {
        expect(arrived.status).toBe('rejected');
        expect(a.status).toBe('CANCELLED_BY_CUSTOMER');
        expect(await bal(t, job.c.walletAccountId)).toMatchObject({ posted: -1500 });
        expect(await bal(t, job.h.walletAccountId!)).toMatchObject({ posted: 3000 });
      } else {
        expect(arrived.status).toBe('fulfilled');
        expect(a.status).toBe('ARRIVED');
        expect(await bal(t, job.c.walletAccountId)).toMatchObject({ posted: 0 });
        expect(await bal(t, job.h.walletAccountId!)).toMatchObject({ posted: 1000 });
      }
      await expectLedgerSound(t);
    }
  });

  it('customer cancel racing "en route" inside the free window: the job always ends cancelled for free, never half-applied', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await fresh();
      const job = await soloJob(t, { proBalance: 2000 });
      const results = await Promise.allSettled([
        t.client(job.c.token).call(api.assignments.cancel, { params: { id: job.assignmentId }, body: {} }),
        t.client(job.h.token).call(api.pro.enRoute, { params: { id: job.assignmentId }, body: { location: BAKU.narimanov } }),
      ]);
      expectDomainRejections(results, ['INVALID_STATE']);
      expect(results[0]!.status).toBe('fulfilled');
      const a = await assignmentRow(t, job.assignmentId);
      expect(a).toMatchObject({ status: 'CANCELLED_FREE', cancelledBy: 'CUSTOMER' });
      expect(await bal(t, job.h.walletAccountId!)).toEqual({ posted: 2000, held: 0, available: 2000 });
      expect((await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: job.requestId } })).status).toBe('CANCELLED');
      await expectLedgerSound(t);
    }
  });

  it('decline on arrival racing the price entry: one outcome only', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await fresh();
      const job = await soloJob(t, { proBalance: 2000 });
      await toArrived(t, job);
      const [decline, price] = await Promise.allSettled([
        t.client(job.c.token).call(api.assignments.declineOnArrival, { params: { id: job.assignmentId }, body: {} }),
        t.client(job.h.token).call(api.pro.enterPrice, { params: { id: job.assignmentId }, body: { labor: 3000, materials: 0 } }),
      ]);
      expectDomainRejections([decline, price], ['INVALID_STATE', 'CANCEL_NOT_ALLOWED']);
      expect([decline.status, price.status].sort()).toEqual(['fulfilled', 'rejected']);
      const a = await assignmentRow(t, job.assignmentId);
      expect(a.status).toBe(decline.status === 'fulfilled' ? 'DECLINED_ON_ARRIVAL' : 'PRICE_PROPOSED');
      await expectLedgerSound(t);
    }
  });

  it('cash confirm racing the auto-complete job: completed once (one fee capture, one completedCount)', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await fresh({ autoCompleteAfterMin: 10 });
      const job = await soloJob(t, { proBalance: 2000 });
      const revenue0 = await platform(t, 'REVENUE');
      await toPriceProposed(t, job);
      t.clock.advance(10 * 60_000);
      const results = await Promise.allSettled([
        t.client(job.c.token).call(api.assignments.confirmPrice, { params: { id: job.assignmentId }, body: { method: 'CASH' } }),
        t.jobs.runDue(),
        t.reconciler.tickAll(),
      ]);
      expectDomainRejections(results, ['INVALID_STATE']);
      const a = await assignmentRow(t, job.assignmentId);
      expect(a).toMatchObject({ status: 'COMPLETED', paymentMethod: 'CASH' });
      expect((await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: job.h.handymanId } })).completedCount).toBe(1);
      expect((await platform(t, 'REVENUE')) - revenue0).toBe(1000);
      expect(await t.prisma.ledgerTransaction.count({ where: { kind: 'REQUEST_FEE_CAPTURE' } })).toBe(1);
      expect(await t.prisma.notification.count({ where: { userId: job.c.userId, type: 'ASSIGNMENT_COMPLETED' } })).toBe(1);
      await expectLedgerSound(t);
    }
  });

  it('card payment succeeding while the auto-complete fires: the job ends COMPLETED as CARD with the guarantee, completed once', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await fresh({ autoCompleteAfterMin: 10 });
      const job = await soloJob(t, { proBalance: 2000 });
      await toPriceProposed(t, job, 4000, 0);
      const conf = await t.client(job.c.token).call(api.assignments.confirmPrice, { params: { id: job.assignmentId }, body: { method: 'CARD' } });
      t.clock.advance(10 * 60_000);
      const payments = t.app.get(PaymentsService);
      const results = await Promise.allSettled([payments.settle(conf.payment!.paymentIntentId, 'SUCCEEDED'), t.jobs.runDue()]);
      expectDomainRejections(results, []);
      const a = await assignmentRow(t, job.assignmentId);
      const intent = await t.prisma.paymentIntent.findUniqueOrThrow({ where: { id: conf.payment!.paymentIntentId } });
      expect(a.status).toBe('COMPLETED');
      expect((await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: job.h.handymanId } })).completedCount).toBe(1);
      if (intent.status === 'SUCCEEDED') {
        // The card money arrived: the job is a card job with the guarantee, whatever finished first.
        expect(a.paymentMethod).toBe('CARD');
        expect(a.guaranteeUntil).not.toBeNull();
        expect(await bal(t, job.h.earningsAccountId!)).toMatchObject({ posted: 4000 });
      } else {
        // The cash completion cancelled the checkout first.
        expect(intent.status).toBe('CANCELLED');
        expect(a.paymentMethod).toBe('CASH');
        expect(await bal(t, job.h.earningsAccountId!)).toMatchObject({ posted: 0 });
      }
      await expectLedgerSound(t);
    }
  });

  it('double submits: two cash confirms (different keys) and two ratings at once -> one success each', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await fresh();
      const job = await soloJob(t, { proBalance: 2000 });
      await toPriceProposed(t, job);
      const confirms = await Promise.allSettled([
        t.client(job.c.token).call(api.assignments.confirmPrice, { params: { id: job.assignmentId }, body: { method: 'CASH' }, idempotencyKey: `k1-${round}-aaaa` }),
        t.client(job.c.token).call(api.assignments.confirmPrice, { params: { id: job.assignmentId }, body: { method: 'CASH' }, idempotencyKey: `k2-${round}-bbbb` }),
      ]);
      expectDomainRejections(confirms, ['INVALID_STATE']);
      expect(confirms.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect((await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: job.h.handymanId } })).completedCount).toBe(1);
      const ratings = await Promise.allSettled([
        t.client(job.c.token).call(api.assignments.rate, { params: { id: job.assignmentId }, body: { stars: 5 } }),
        t.client(job.c.token).call(api.assignments.rate, { params: { id: job.assignmentId }, body: { stars: 1 } }),
      ]);
      expectDomainRejections(ratings, ['ALREADY_RATED']);
      expect(ratings.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const hp = await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: job.h.handymanId } });
      expect(hp.ratingCount).toBe(1);
      await expectLedgerSound(t);
    }
  });
});
