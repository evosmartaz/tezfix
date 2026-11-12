import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api } from '@tezfiks/shared';
import { createTestApp, type TestApp } from '../helpers/app';
import { BAKU, createCompany, createCustomer, createSoloHandyman } from '../helpers/factories';
import { advance, assignmentRow, bal, companyJob, createRequest, expectLedgerSound, goOnline, payWithCard, setSettings, soloJob } from './helpers';

describe('B3 company jobs: worker-limited views, manager price entry, reassign, company lists', () => {
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

  it('manager price entry: the worker travels and arrives, only a manager enters the price, the worker never sees price/fee/description/customer rating', async () => {
    const job = await companyJob(t, { finalPriceEntry: 'MANAGER', balance: 5000 });
    const { c, co, worker, assignmentId: id } = job;
    // Give the customer a rating so a leak would be visible.
    await t.prisma.customerAccount.update({ where: { id: c.accountId }, data: { ratingSum: 9, ratingCount: 2 } });
    const W = t.client(worker.token);
    const M = t.client(co.manager.token);

    let wv = await W.call(api.pro.assignment, { params: { id } });
    expect(wv).toMatchObject({
      view: 'WORKER_LIMITED',
      description: null,
      photos: [],
      price: null,
      fee: null,
      tipAmount: null,
      customerPhone: null,
      customer: { firstName: 'Nizami', lastInitial: 'T.', ratingAvg: null, ratingCount: null },
      worker: { phone: null },
      actions: { enRoute: true, arrived: true, enterPrice: false, rateCustomer: false },
    });
    // The worker still gets the full address (spec 4.4: location/address, category, customer name + photo).
    expect(wv.address).toMatchObject({ apartment: 'mənzil 45', entrance: '2-ci giriş' });
    let mv = await M.call(api.company.assignment, { params: { companyId: co.companyId, id } });
    expect(mv).toMatchObject({ view: 'FULL', fee: { amount: 1000, captured: false }, worker: { phone: worker.phone } });
    expect(mv.description).toContain('kran');
    expect(mv.customer.ratingAvg).toBe(4.5);

    // Only the doer goes en route / arrives.
    await expect(M.call(api.pro.enRoute, { params: { id }, body: {} })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    await W.call(api.pro.enRoute, { params: { id }, body: { location: BAKU.narimanov } });
    wv = await W.call(api.pro.arrived, { params: { id } });
    // Workers do not chat with the customer (spec 4.4: "contact the manager"): chat stays off in the worker-limited view.
    expect(wv).toMatchObject({ status: 'ARRIVED', contactUnlocked: true, customerPhone: null, chatEnabled: false });
    // The customer sees the worker's phone after unlock, and the company name.
    const cv = await t.client(c.token).call(api.assignments.get, { params: { id } });
    expect(cv).toMatchObject({ providerPhone: worker.phone, provider: { type: 'COMPANY', company: { id: co.companyId, name: 'FixPro MMC' } } });

    // finalPriceEntry = MANAGER: the worker is refused, the manager enters it (pro route or company route).
    await expect(W.call(api.pro.enterPrice, { params: { id }, body: { labor: 5000, materials: 0 } })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    mv = await M.call(api.company.enterPrice, { params: { companyId: co.companyId, id }, body: { labor: 6000, materials: 1500 } });
    expect(mv).toMatchObject({ status: 'PRICE_PROPOSED', price: { total: 7500 } });
    expect((await assignmentRow(t, id)).priceEnteredByUserId).toBe(co.manager.userId);
    wv = await W.call(api.pro.assignment, { params: { id } });
    expect(wv).toMatchObject({ status: 'PRICE_PROPOSED', price: null, fee: null });

    // Card payment: the company's earnings are credited (company money, not the worker's).
    const conf = await t.client(c.token).call(api.assignments.confirmPrice, { params: { id }, body: { method: 'CARD' } });
    expect((await t.prisma.paymentIntent.findUniqueOrThrow({ where: { id: conf.payment!.paymentIntentId } })).walletAccountId).toBe(co.earningsAccountId);
    await payWithCard(t, conf.payment!.checkoutUrl);
    expect(await bal(t, co.earningsAccountId)).toMatchObject({ posted: 7500 });
    expect((await t.prisma.company.findUniqueOrThrow({ where: { id: co.companyId } })).completedCount).toBe(1);
    expect((await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: worker.handymanId } })).completedCount).toBe(1);
    // Still hidden from the worker after completion.
    wv = await W.call(api.pro.assignment, { params: { id } });
    expect(wv).toMatchObject({ status: 'COMPLETED', price: null, fee: null, tipAmount: null, actions: { rateCustomer: false } });
    // Tip: managers are told, not the worker.
    const tip = await t.client(c.token).call(api.assignments.tip, { params: { id }, body: { amount: 1000 } });
    await payWithCard(t, tip.checkoutUrl);
    expect(await t.prisma.notification.count({ where: { userId: co.manager.userId, type: 'TIP_RECEIVED' } })).toBe(1);
    expect(await t.prisma.notification.count({ where: { userId: worker.userId, type: 'TIP_RECEIVED' } })).toBe(0);
    // Ratings: the customer rates (worker + company aggregates), the manager rates the customer, the worker may not.
    await t.client(c.token).call(api.assignments.rate, { params: { id }, body: { stars: 4 } });
    expect(await t.prisma.company.findUniqueOrThrow({ where: { id: co.companyId } })).toMatchObject({ ratingSum: 4, ratingCount: 1 });
    expect(await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: worker.handymanId } })).toMatchObject({ ratingSum: 4, ratingCount: 1 });
    await expect(W.call(api.pro.rateCustomer, { params: { id }, body: { stars: 5 } })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await M.call(api.pro.rateCustomer, { params: { id }, body: { stars: 5 } });
    // Notifications to the worker never carry amounts.
    for (const n of await t.prisma.notification.findMany({ where: { userId: worker.userId } })) {
      expect(n.body).not.toMatch(/75,00|7\.500|₼/);
      expect(JSON.stringify(n.data)).not.toContain('7500');
    }
    await expectLedgerSound(t);
  });

  it('worker price entry: the worker enters the price and sees it; the manager route is refused', async () => {
    const job = await companyJob(t, { finalPriceEntry: 'WORKER' });
    const { co, worker, assignmentId: id } = job;
    const W = t.client(worker.token);
    await W.call(api.pro.enRoute, { params: { id }, body: { location: BAKU.narimanov } });
    await W.call(api.pro.arrived, { params: { id } });
    await expect(
      t.client(co.manager.token).call(api.company.enterPrice, { params: { companyId: co.companyId, id }, body: { labor: 100, materials: 0 } }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(t.client(co.manager.token).call(api.pro.enterPrice, { params: { id }, body: { labor: 100, materials: 0 } })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    const wv = await W.call(api.pro.enterPrice, { params: { id }, body: { labor: 3000, materials: 200 } });
    expect(wv).toMatchObject({ view: 'WORKER_LIMITED', status: 'PRICE_PROPOSED', price: { total: 3200 }, fee: null, description: null });
  });

  it('reassign: ACCEPTED only, to an active, approved, free member with the trade', async () => {
    const job = await companyJob(t, { workers: 3 });
    const { co, assignmentId: id } = job;
    const [w0, w1, w2] = co.workers;
    const M = t.client(co.manager.token);
    const call = (workerId: string) => M.call(api.company.reassign, { params: { companyId: co.companyId, id }, body: { workerId } });

    // Not a member of this company.
    const outsider = await createSoloHandyman(t);
    await expect(call(outsider.handymanId)).rejects.toMatchObject({ code: 'WORKER_UNAVAILABLE', status: 409 });
    // Without the trade.
    await t.prisma.handymanTrade.deleteMany({ where: { handymanId: w2!.handymanId } });
    await expect(call(w2!.handymanId)).rejects.toMatchObject({ code: 'WORKER_UNAVAILABLE', details: { reason: 'NO_TRADE' } });
    // Removed member.
    await t.prisma.companyMember.updateMany({ where: { companyId: co.companyId, userId: w2!.userId }, data: { status: 'REMOVED' } });
    await expect(call(w2!.handymanId)).rejects.toMatchObject({ code: 'WORKER_UNAVAILABLE', details: { reason: 'NOT_A_MEMBER' } });

    // A free worker (by user id): the job moves, the new worker is told, the old one gets ASSIGNMENT_CANCELLED.
    const mv = await call(w1!.userId);
    expect(mv).toMatchObject({ status: 'ACCEPTED', worker: { handymanId: w1!.handymanId } });
    expect((await assignmentRow(t, id)).handymanId).toBe(w1!.handymanId);
    expect(await t.prisma.notification.count({ where: { userId: w1!.userId, type: 'WORKER_ASSIGNED' } })).toBe(1);
    expect(await t.prisma.notification.count({ where: { userId: w0!.userId, type: 'ASSIGNMENT_CANCELLED' } })).toBe(1);
    // The old worker lost access; the fee hold stays on the company wallet.
    await expect(t.client(w0!.token).call(api.pro.assignment, { params: { id } })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await bal(t, co.walletAccountId)).toEqual({ posted: 5000, held: 1000, available: 4000 });

    // Busy: w0 takes another job of the company, then moving ours to w0 is refused.
    const c2 = await createCustomer(t);
    const req2 = await createRequest(t, c2, { slug: 'plumbing' });
    const offer2 = await t.prisma.offer.findFirstOrThrow({ where: { requestId: req2.id, companyId: co.companyId } });
    await M.call(api.company.acceptOffer, { params: { companyId: co.companyId, offerId: offer2.id }, body: { workerIds: [w0!.handymanId] } });
    await expect(call(w0!.handymanId)).rejects.toMatchObject({ code: 'WORKER_UNAVAILABLE', details: { reason: 'BUSY' } });

    // After en route: INVALID_STATE.
    await t.client(w1!.token).call(api.pro.enRoute, { params: { id }, body: { location: BAKU.narimanov } });
    await expect(call(w2!.handymanId)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    // Workers are not managers; other companies get NOT_FOUND.
    await expect(
      t.client(w1!.token).call(api.company.reassign, { params: { companyId: co.companyId, id }, body: { workerId: w0!.handymanId } }),
    ).rejects.toMatchObject({ code: 'NOT_COMPANY_MANAGER' });
    const otherCo = await createCompany(t, { trades: ['plumbing'], workers: 1 });
    await expect(
      t.client(otherCo.manager.token).call(api.company.reassign, { params: { companyId: otherCo.companyId, id }, body: { workerId: otherCo.workers[0]!.handymanId } }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      t.client(otherCo.manager.token).call(api.company.assignment, { params: { companyId: co.companyId, id } }),
    ).rejects.toMatchObject({ code: 'NOT_COMPANY_MANAGER' });
  });

  it('company lists by scope; a manager sees the job via the pro route in manager mode', async () => {
    const job = await companyJob(t);
    const { co, assignmentId: id } = job;
    const M = t.client(co.manager.token);
    const active = await M.call(api.company.assignments, { params: { companyId: co.companyId }, query: { scope: 'active' } });
    expect(active.items.map((a) => a.id)).toEqual([id]);
    expect(active.items[0]!.view).toBe('FULL');
    expect((await M.call(api.company.assignments, { params: { companyId: co.companyId }, query: { scope: 'history' } })).items).toEqual([]);
    const pv = await M.call(api.pro.assignment, { params: { id } });
    expect(pv.view).toBe('FULL');
    // The worker's own list.
    const mine = await t.client(job.worker.token).call(api.pro.assignments, { query: { scope: 'active' } });
    expect(mine.items.map((a) => [a.id, a.view])).toEqual([[id, 'WORKER_LIMITED']]);
    // Pagination.
    const page = await M.call(api.company.assignments, { params: { companyId: co.companyId }, query: { limit: 1 } });
    expect(page.items).toHaveLength(1);
    await advance(t, 301_000);
    expect(await bal(t, co.walletAccountId)).toEqual({ posted: 4000, held: 0, available: 4000 });
    // Solo pros never see company jobs.
    const solo = await soloJob(t);
    await expect(t.client(solo.h.token).call(api.pro.assignment, { params: { id } })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await goOnline(t, solo.h.handymanId, BAKU.center);
  });
});
