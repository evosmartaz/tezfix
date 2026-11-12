import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api } from '@tezfiks/shared';
import { createTestApp, type TestApp } from '../helpers/app';
import { BAKU, createSoloHandyman, tokenFor } from '../helpers/factories';
import { advance, assignmentRow, bal, companyJob, expectLedgerSound, goOnline, platform, setSettings, soloJob, toArrived, toPriceProposed } from './helpers';

describe('B3 cancellation entry points over HTTP (customer, provider, company) with balances', () => {
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

  it('customer cancels inside the free window: free, fee hold released, request cancelled', async () => {
    const job = await soloJob(t, { proBalance: 2000 });
    const out = await t.client(job.c.token).call(api.assignments.cancel, { params: { id: job.assignmentId }, body: { reason: 'Planlar dəyişdi' } });
    expect(out).toMatchObject({ status: 'CANCELLED_FREE', cancelledBy: 'CUSTOMER' });
    expect(await bal(t, job.h.walletAccountId!)).toEqual({ posted: 2000, held: 0, available: 2000 });
    expect(await bal(t, job.c.walletAccountId)).toEqual({ posted: 0, held: 0, available: 0 });
    const r = await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: job.requestId } });
    expect(r).toMatchObject({ status: 'CANCELLED', cancelledBy: 'CUSTOMER', cancelReason: 'Planlar dəyişdi' });
    expect(await t.prisma.notification.count({ where: { userId: job.h.userId, type: 'ASSIGNMENT_CANCELLED' } })).toBe(1);
    await expectLedgerSound(t);
  });

  it('customer cancels after the window while en route: 15 AZN penalty (debt allowed), fee refunded, 10 AZN compensation', async () => {
    const job = await soloJob(t, { proBalance: 2000, customerBalance: 0 });
    const revenue0 = await platform(t, 'REVENUE');
    const promo0 = await platform(t, 'PROMO');
    await advance(t, 301_000);
    await t.client(job.h.token).call(api.pro.enRoute, { params: { id: job.assignmentId }, body: { location: BAKU.narimanov } });
    const view = await t.client(job.c.token).call(api.assignments.get, { params: { id: job.assignmentId } });
    expect(view.actions).toMatchObject({ cancel: true, cancelPenalty: 1500 });
    const out = await t.client(job.c.token).call(api.assignments.cancel, { params: { id: job.assignmentId }, body: {} });
    expect(out.status).toBe('CANCELLED_BY_CUSTOMER');
    expect(await bal(t, job.c.walletAccountId)).toMatchObject({ posted: -1500 });
    expect(await bal(t, job.h.walletAccountId!)).toEqual({ posted: 3000, held: 0, available: 3000 });
    expect((await platform(t, 'REVENUE')) - revenue0).toBe(1500);
    expect((await platform(t, 'PROMO')) - promo0).toBe(-1000);
    // The customer is now in debt: new requests are refused.
    await expect(
      t.client(job.c.token).call(api.requests.create, {
        body: { categoryId: (await t.prisma.category.findUniqueOrThrow({ where: { slug: 'plumbing' } })).id, description: 'Yenə kran axır', timing: 'NOW', address: { lat: BAKU.center.lat, lng: BAKU.center.lng, formatted: 'Bakı' } },
      }),
    ).rejects.toMatchObject({ code: 'CUSTOMER_IN_DEBT', status: 402 });
    await expectLedgerSound(t);
  });

  it('decline on arrival: only when ARRIVED; same money as a late customer cancel; cancel is not allowed once arrived', async () => {
    const job = await soloJob(t, { proBalance: 2000 });
    const C = t.client(job.c.token);
    await expect(C.call(api.assignments.declineOnArrival, { params: { id: job.assignmentId }, body: {} })).rejects.toMatchObject({
      code: 'CANCEL_NOT_ALLOWED',
      status: 409,
    });
    await toArrived(t, job);
    await expect(C.call(api.assignments.cancel, { params: { id: job.assignmentId }, body: {} })).rejects.toMatchObject({ code: 'CANCEL_NOT_ALLOWED' });
    await expect(t.client(job.h.token).call(api.pro.cancel, { params: { id: job.assignmentId }, body: {} })).rejects.toMatchObject({ code: 'CANCEL_NOT_ALLOWED' });
    const view = await C.call(api.assignments.get, { params: { id: job.assignmentId } });
    expect(view.actions).toMatchObject({ declineOnArrival: true, declinePenalty: 1500, cancel: false });
    const out = await C.call(api.assignments.declineOnArrival, { params: { id: job.assignmentId }, body: { reason: 'Qiymət baha' } });
    expect(out.status).toBe('DECLINED_ON_ARRIVAL');
    expect(await bal(t, job.c.walletAccountId)).toMatchObject({ posted: -1500 });
    // Fee hold released inside the window (no capture yet), compensation credited.
    expect(await bal(t, job.h.walletAccountId!)).toEqual({ posted: 3000, held: 0, available: 3000 });
    await expectLedgerSound(t);
  });

  it('report no-show: TOO_EARLY before noShowAfterMin; afterwards NO_SHOW with the fee kept, a strike and the slot re-dispatched', async () => {
    const job = await soloJob(t, { proBalance: 2000 });
    const other = await createSoloHandyman(t, { balance: 2000 });
    await goOnline(t, other.handymanId, BAKU.center);
    const C = t.client(job.c.token);
    await expect(C.call(api.assignments.reportNoShow, { params: { id: job.assignmentId } })).rejects.toMatchObject({ code: 'TOO_EARLY', status: 409 });
    await advance(t, 45 * 60_000);
    await goOnline(t, other.handymanId, BAKU.center);
    // Access tokens expire on the business clock: log in again after 45 minutes.
    const C2 = t.client(await tokenFor(t, job.c.userId, 'CUSTOMER'));
    const view = await C2.call(api.assignments.get, { params: { id: job.assignmentId } });
    expect(view.actions.reportNoShow).toBe(true);
    const out = await C2.call(api.assignments.reportNoShow, { params: { id: job.assignmentId } });
    expect(out.status).toBe('NO_SHOW');
    expect(await bal(t, job.h.walletAccountId!)).toEqual({ posted: 1000, held: 0, available: 1000 });
    expect(await bal(t, job.c.walletAccountId)).toMatchObject({ posted: 0 });
    expect((await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: job.h.handymanId } })).strikes).toBe(1);
    const r = await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: job.requestId }, include: { slots: true } });
    expect(r).toMatchObject({ status: 'SEARCHING', isSearching: true });
    expect(r.slots[0]!.status).toBe('OPEN');
    expect(await t.prisma.offer.count({ where: { requestId: job.requestId, handymanId: other.handymanId } })).toBe(1);
    await expectLedgerSound(t);
  });

  it('provider cancels: free inside the window (re-dispatch), late afterwards (fee kept + strike); not after arrival', async () => {
    const job = await soloJob(t, { proBalance: 2000 });
    const H = t.client(job.h.token);
    const free = await H.call(api.pro.cancel, { params: { id: job.assignmentId }, body: { reason: 'Maşın xarab oldu' } });
    expect(free).toMatchObject({ status: 'CANCELLED_FREE', cancelledBy: 'PROVIDER' });
    expect(await bal(t, job.h.walletAccountId!)).toEqual({ posted: 2000, held: 0, available: 2000 });
    expect((await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: job.requestId } })).status).toBe('SEARCHING');
    expect(await t.prisma.notification.count({ where: { userId: job.c.userId, type: 'ASSIGNMENT_CANCELLED' } })).toBe(1);

    await t.reset();
    await setSettings(t, { minCandidates: 0 });
    const late = await soloJob(t, { proBalance: 2000 });
    await advance(t, 301_000);
    const out = await t.client(late.h.token).call(api.pro.cancel, { params: { id: late.assignmentId }, body: {} });
    expect(out.status).toBe('CANCELLED_BY_PROVIDER');
    expect(await bal(t, late.h.walletAccountId!)).toEqual({ posted: 1000, held: 0, available: 1000 });
    expect((await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: late.h.handymanId } })).strikes).toBe(1);
    expect(await t.prisma.strikeEvent.count({ where: { handymanId: late.h.handymanId, reason: 'LATE_PROVIDER_CANCEL' } })).toBe(1);
    // Terminal now.
    await expect(t.client(late.h.token).call(api.pro.cancel, { params: { id: late.assignmentId }, body: {} })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(t.client(late.c.token).call(api.assignments.cancel, { params: { id: late.assignmentId }, body: {} })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expectLedgerSound(t);
  });

  it('company manager cancels a company job: the hold on the company wallet is released (free window), strike on the company when late', async () => {
    const job = await companyJob(t, { balance: 5000 });
    expect(await bal(t, job.co.walletAccountId)).toEqual({ posted: 5000, held: 1000, available: 4000 });
    const out = await t.client(job.co.manager.token).call(api.company.cancelAssignment, {
      params: { companyId: job.co.companyId, id: job.assignmentId },
      body: {},
    });
    expect(out).toMatchObject({ status: 'CANCELLED_FREE', view: 'FULL' });
    expect(await bal(t, job.co.walletAccountId)).toEqual({ posted: 5000, held: 0, available: 5000 });

    await t.reset();
    await setSettings(t, { minCandidates: 0 });
    const late = await companyJob(t, { balance: 5000 });
    await advance(t, 301_000);
    // The worker can cancel too (provider side).
    const w = await t.client(late.worker.token).call(api.pro.cancel, { params: { id: late.assignmentId }, body: {} });
    expect(w.status).toBe('CANCELLED_BY_PROVIDER');
    expect((await t.prisma.company.findUniqueOrThrow({ where: { id: late.co.companyId } })).strikes).toBe(1);
    expect(await bal(t, late.co.walletAccountId)).toEqual({ posted: 4000, held: 0, available: 4000 });
    // Another company's manager or a customer cannot touch it.
    await expect(
      t.client(late.c.token).call(api.company.cancelAssignment, { params: { companyId: late.co.companyId, id: late.assignmentId }, body: {} }),
    ).rejects.toMatchObject({ code: 'NOT_COMPANY_MANAGER' });
    await expectLedgerSound(t);
  });

  it('idempotent cancel: a replay with the same key returns the stored result and applies the cancellation once', async () => {
    const job = await soloJob(t, { proBalance: 2000 });
    await advance(t, 301_000);
    const C = t.client(job.c.token);
    const first = await C.call(api.assignments.cancel, { params: { id: job.assignmentId }, body: {}, idempotencyKey: 'cancel-key-0001' });
    const again = await C.call(api.assignments.cancel, { params: { id: job.assignmentId }, body: {}, idempotencyKey: 'cancel-key-0001' });
    expect(again.status).toBe(first.status);
    expect(await bal(t, job.c.walletAccountId)).toMatchObject({ posted: -1500 });
    expect(await t.prisma.ledgerTransaction.count({ where: { kind: 'CANCEL_PENALTY' } })).toBe(1);
    await expect(C.call(api.assignments.cancel, { params: { id: job.assignmentId }, body: {}, idempotencyKey: 'cancel-key-0002' })).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
    await expectLedgerSound(t);
  });

  it('cannot cancel once a price is proposed; other customers get NOT_FOUND', async () => {
    const job = await soloJob(t);
    await toPriceProposed(t, job);
    await expect(t.client(job.c.token).call(api.assignments.cancel, { params: { id: job.assignmentId }, body: {} })).rejects.toMatchObject({
      code: 'CANCEL_NOT_ALLOWED',
    });
    const stranger = await soloJob(t);
    await expect(t.client(stranger.c.token).call(api.assignments.cancel, { params: { id: job.assignmentId }, body: {} })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect((await assignmentRow(t, job.assignmentId)).status).toBe('PRICE_PROPOSED');
  });
});
