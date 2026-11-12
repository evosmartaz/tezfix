import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, rooms } from '@tezfiks/shared';
import { createTestApp, type TestApp } from '../helpers/app';
import { PaymentsService } from '../../src/modules/payments/payments.service';
import { BAKU } from '../helpers/factories';
import {
  DECLINED_CARD,
  placeAt,
  addDevice,
  advance,
  along,
  assignmentRow,
  bal,
  completion,
  expectLedgerSound,
  geo,
  payWithCard,
  platform,
  pushLog,
  setSettings,
  soloJob,
  toArrived,
  toPriceProposed,
} from './helpers';

describe('B3 assignment lifecycle (solo): en route, tracking, contact unlock, price, card/cash payment, tip, ratings', () => {
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

  it('full happy path: en route -> pings lower the ETA -> contact unlocks at <= 300 s -> arrived -> price -> card checkout -> completed + guarantee -> tip -> ratings both ways', async () => {
    const job = await soloJob(t, { proBalance: 2000 });
    const { c, h, assignmentId: id } = job;
    await addDevice(t, c.userId, 'CUSTOMER');
    const C = t.client(c.token);
    const H = t.client(h.token);
    const revenue0 = await platform(t, 'REVENUE');

    // The free-cancel window closes: the request fee is captured.
    await advance(t, 301_000);
    expect(await bal(t, h.walletAccountId!)).toEqual({ posted: 1000, held: 0, available: 1000 });

    // Before en route: no phone anywhere, chat locked.
    let cv = await C.call(api.assignments.get, { params: { id } });
    expect(cv).toMatchObject({ status: 'ACCEPTED', contactUnlocked: false, providerPhone: null, chatEnabled: false, etaSec: null, route: null });
    let pv = await H.call(api.pro.assignment, { params: { id } });
    expect(pv).toMatchObject({ view: 'FULL', customerPhone: null, contactUnlocked: false, actions: { enRoute: true, arrived: true, enterPrice: false } });

    // "Yola çıxdım" from Əhmədli (~9 km): route computed once (fallback without a maps key), ETA = route duration.
    const from = BAKU.ahmadli;
    const to = BAKU.center;
    const expected = geo(t).fallbackRouteResult(from, to);
    pv = await H.call(api.pro.enRoute, { params: { id }, body: { location: from } });
    expect(pv.status).toBe('EN_ROUTE');
    expect(pv.route).toMatchObject({ source: 'fallback', durationSec: expected.durationSec, distanceM: expected.distanceM });
    expect(pv.etaSec).toBe(expected.durationSec);
    expect(pv.customerPhone).toBeNull();
    expect((await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: job.requestId } })).status).toBe('IN_PROGRESS');
    expect(await t.prisma.notification.count({ where: { userId: c.userId, type: 'ASSIGNMENT_EN_ROUTE' } })).toBe(1);
    const enRouteRoute = (await assignmentRow(t, id)).routeComputedAt;

    // Location pings along the route lower the ETA; assignment:location goes to the assignment room and the customer.
    t.realtime.clearSent();
    const etas: number[] = [];
    for (const f of [0.25, 0.5, 0.7]) {
      t.clock.advance(5_000);
      const p = along(from, to, f);
      await H.call(api.pro.location, { body: { lat: p.lat, lng: p.lng } });
      const row = await assignmentRow(t, id);
      etas.push(row.etaSec!);
      expect(row).toMatchObject({ lastLat: p.lat, lastLng: p.lng });
      expect(row.contactUnlockedAt).toBeNull();
    }
    expect(etas[0]!).toBeLessThan(expected.durationSec);
    expect(etas[1]!).toBeLessThan(etas[0]!);
    expect(etas[2]!).toBeLessThan(etas[1]!);
    expect(Math.abs(etas[1]! - expected.durationSec / 2)).toBeLessThanOrEqual(3);
    // On the route: no re-routing.
    expect((await assignmentRow(t, id)).routeComputedAt).toEqual(enRouteRoute);
    const locEvents = t.realtime.sentTo(rooms.assignment(id), 'assignment:location');
    expect(locEvents).toHaveLength(3);
    expect(locEvents[2]!.payload).toMatchObject({ assignmentId: id, etaSec: etas[2] });
    expect(t.realtime.sentTo(rooms.user(c.userId), 'assignment:location')).toHaveLength(3);
    cv = await C.call(api.assignments.get, { params: { id } });
    expect(cv).toMatchObject({ etaSec: etas[2], providerPhone: null, contactUnlocked: false });
    expect(cv.location).toMatchObject({ lat: along(from, to, 0.7).lat });

    // Exact boundary: the unlock threshold equal to the ETA unlocks (<=), one second below does not.
    const near = along(from, to, 0.8);
    t.clock.advance(5_000);
    await H.call(api.pro.location, { body: { lat: near.lat, lng: near.lng } });
    const e = (await assignmentRow(t, id)).etaSec!;
    expect(e).toBeGreaterThan(300); // still locked at the default 300 s
    expect((await assignmentRow(t, id)).contactUnlockedAt).toBeNull();
    await setSettings(t, { contactUnlockEtaSec: e - 1 });
    t.clock.advance(5_000);
    await H.call(api.pro.location, { body: { lat: near.lat, lng: near.lng } });
    expect((await assignmentRow(t, id)).etaSec).toBe(e);
    expect((await assignmentRow(t, id)).contactUnlockedAt).toBeNull();
    await setSettings(t, { contactUnlockEtaSec: e });
    t.clock.advance(5_000);
    await H.call(api.pro.location, { body: { lat: near.lat, lng: near.lng } });
    expect((await assignmentRow(t, id)).contactUnlockedAt).not.toBeNull();
    expect(t.realtime.sentTo(rooms.assignment(id), 'assignment:contact')).toHaveLength(1);
    expect(t.realtime.sentTo(rooms.user(c.userId), 'assignment:contact')).toHaveLength(1);
    const nearN = await t.prisma.notification.findMany({ where: { userId: c.userId, type: 'ASSIGNMENT_NEAR' } });
    expect(nearN).toHaveLength(1);
    // Unlocked: phones appear in both views, chat opens.
    cv = await C.call(api.assignments.get, { params: { id } });
    expect(cv).toMatchObject({ contactUnlocked: true, providerPhone: h.phone, chatEnabled: true });
    pv = await H.call(api.pro.assignment, { params: { id } });
    expect(pv).toMatchObject({ contactUnlocked: true, customerPhone: c.phone, chatEnabled: true });
    // Never relocks: further away again keeps it unlocked and no second event.
    await setSettings(t, { contactUnlockEtaSec: 300 });
    t.clock.advance(5_000);
    const back = along(from, to, 0.3);
    await H.call(api.pro.location, { body: { lat: back.lat, lng: back.lng } });
    expect((await assignmentRow(t, id)).contactUnlockedAt).not.toBeNull();
    expect(t.realtime.sentTo(rooms.assignment(id), 'assignment:contact')).toHaveLength(1);
    // Push payloads never carry phone numbers.
    for (const p of pushLog(t).sentTo(c.userId)) {
      expect(JSON.stringify(p.message)).not.toContain(h.phone.slice(4));
    }

    // Arrived (the pro drives on to the door: the server-side position is at the address).
    await placeAt(t, h.handymanId, to);
    pv = await H.call(api.pro.arrived, { params: { id } });
    expect(pv).toMatchObject({ status: 'ARRIVED', etaSec: 0, actions: { enterPrice: true, cancel: false } });
    expect(await t.prisma.notification.count({ where: { userId: c.userId, type: 'ASSIGNMENT_ARRIVED' } })).toBe(1);

    // Price: labour 40 AZN + materials 10 AZN.
    pv = await H.call(api.pro.enterPrice, { params: { id }, body: { labor: 4000, materials: 1000 } });
    expect(pv).toMatchObject({ status: 'PRICE_PROPOSED', price: { labor: 4000, materials: 1000, total: 5000 } });
    const priceN = await t.prisma.notification.findFirstOrThrow({ where: { userId: c.userId, type: 'PRICE_PROPOSED' } });
    expect(priceN.body).toContain('50,00');
    cv = await C.call(api.assignments.get, { params: { id } });
    expect(cv.actions).toMatchObject({ confirmPrice: true, disputePrice: true, cancel: false, tip: false, rate: false });

    // Card: a test checkout; the job completes only when the payment succeeds.
    const conf = await C.call(api.assignments.confirmPrice, { params: { id }, body: { method: 'CARD', returnUrl: 'tezfiks://payment' } });
    expect(conf.assignment.status).toBe('PRICE_PROPOSED');
    expect(conf.payment).not.toBeNull();
    expect(conf.assignment.payment).toEqual({ intentId: conf.payment!.paymentIntentId, status: 'CREATED' });
    const intent = await t.prisma.paymentIntent.findUniqueOrThrow({ where: { id: conf.payment!.paymentIntentId } });
    expect(intent).toMatchObject({ purpose: 'JOB_PAYMENT', amount: 5000n, assignmentId: id, walletAccountId: h.earningsAccountId });
    // A declined card changes nothing.
    const declined = await C.call(api.assignments.confirmPrice, { params: { id }, body: { method: 'CARD' } });
    expect(declined.payment!.paymentIntentId).toBe(conf.payment!.paymentIntentId); // the open checkout is reused
    await payWithCard(t, conf.payment!.checkoutUrl, DECLINED_CARD);
    expect((await assignmentRow(t, id)).status).toBe('PRICE_PROPOSED');
    const retry = await C.call(api.assignments.confirmPrice, { params: { id }, body: { method: 'CARD', returnUrl: 'tezfiks://payment' } });
    expect(retry.payment!.paymentIntentId).not.toBe(conf.payment!.paymentIntentId);
    const res = await payWithCard(t, retry.payment!.checkoutUrl);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('tezfiks://payment');
    const done = await assignmentRow(t, id);
    expect(done).toMatchObject({ status: 'COMPLETED', paymentMethod: 'CARD', paymentIntentId: retry.payment!.paymentIntentId });
    expect(done.guaranteeUntil!.getTime()).toBe(done.completedAt!.getTime() + 14 * 86_400_000);
    expect(await bal(t, h.earningsAccountId!)).toMatchObject({ posted: 5000 });
    const r = await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: job.requestId }, include: { slots: true } });
    expect(r.status).toBe('COMPLETED');
    expect(r.slots[0]!.status).toBe('DONE');
    expect((await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: h.handymanId } })).completedCount).toBe(1);
    expect(await t.prisma.notification.count({ where: { userId: c.userId, type: 'ASSIGNMENT_COMPLETED' } })).toBe(1);
    expect(await t.prisma.notification.count({ where: { userId: h.userId, type: 'ASSIGNMENT_COMPLETED' } })).toBe(1);
    cv = await C.call(api.assignments.get, { params: { id } });
    expect(cv.actions).toMatchObject({ tip: true, rate: true, guaranteeClaim: true, confirmPrice: false });
    expect(cv.payment).toEqual({ intentId: retry.payment!.paymentIntentId, status: 'SUCCEEDED' });
    // The fee was captured exactly once (window close), never again at completion.
    expect((await platform(t, 'REVENUE')) - revenue0).toBe(1000);

    // Tip after the card payment.
    const tip = await C.call(api.assignments.tip, { params: { id }, body: { amount: 500 } });
    await payWithCard(t, tip.checkoutUrl);
    expect(Number((await assignmentRow(t, id)).tipAmount)).toBe(500);
    expect(await bal(t, h.earningsAccountId!)).toMatchObject({ posted: 5500 });
    expect(await t.prisma.notification.count({ where: { userId: h.userId, type: 'TIP_RECEIVED' } })).toBe(1);
    cv = await C.call(api.assignments.get, { params: { id } });
    expect(cv).toMatchObject({ tipAmount: 500, actions: { tip: false } });
    await expect(C.call(api.assignments.tip, { params: { id }, body: { amount: 300 } })).rejects.toMatchObject({ code: 'INVALID_STATE', status: 409 });
    // Re-running the tip listener / reconciler does not double count.
    await completion(t).applyTip(id);
    await t.reconciler.tickAll();
    expect(Number((await assignmentRow(t, id)).tipAmount)).toBe(500);

    // Ratings both ways, once each.
    await C.call(api.assignments.rate, { params: { id }, body: { stars: 5, comment: 'Əla iş, çox sağ olun!' } });
    await expect(C.call(api.assignments.rate, { params: { id }, body: { stars: 4 } })).rejects.toMatchObject({ code: 'ALREADY_RATED', status: 409 });
    const hp = await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: h.handymanId } });
    expect(hp).toMatchObject({ ratingSum: 5, ratingCount: 1 });
    expect(await t.prisma.notification.count({ where: { userId: h.userId, type: 'RATING_RECEIVED' } })).toBe(1);
    const rating = await t.prisma.rating.findFirstOrThrow({ where: { assignmentId: id, direction: 'CUSTOMER_TO_PROVIDER' } });
    expect(rating.comment).toBe('Əla iş, çox sağ olun!');
    await H.call(api.pro.rateCustomer, { params: { id }, body: { stars: 4 } });
    await expect(H.call(api.pro.rateCustomer, { params: { id }, body: { stars: 4 } })).rejects.toMatchObject({ code: 'ALREADY_RATED' });
    const acc = await t.prisma.customerAccount.findUniqueOrThrow({ where: { id: c.accountId } });
    expect(acc).toMatchObject({ ratingSum: 4, ratingCount: 1 });
    pv = await H.call(api.pro.assignment, { params: { id } });
    expect(pv).toMatchObject({ ratedCustomer: true, actions: { rateCustomer: false }, tipAmount: 500, paymentStatus: 'SUCCEEDED' });
    expect((await C.call(api.assignments.get, { params: { id } })).rated).toBe(true);
    await expectLedgerSound(t);
  });

  it('cash path: confirming cash completes at once, captures a still-held fee immediately, no guarantee, no tip', async () => {
    const job = await soloJob(t, { proBalance: 2000 });
    const { c, h, assignmentId: id } = job;
    const revenue0 = await platform(t, 'REVENUE');
    await toPriceProposed(t, job, 3000, 0);
    // Still inside the free-cancel window: the fee is only held.
    expect(await bal(t, h.walletAccountId!)).toEqual({ posted: 2000, held: 1000, available: 1000 });
    const out = await t.client(c.token).call(api.assignments.confirmPrice, { params: { id }, body: { method: 'CASH' } });
    expect(out.payment).toBeNull();
    expect(out.assignment).toMatchObject({ status: 'COMPLETED', paymentMethod: 'CASH', guaranteeUntil: null, actions: { tip: false, guaranteeClaim: false, rate: true } });
    expect(await bal(t, h.walletAccountId!)).toEqual({ posted: 1000, held: 0, available: 1000 });
    expect((await platform(t, 'REVENUE')) - revenue0).toBe(1000);
    // Cash goes to the pro at the door: no earnings booked.
    expect(await bal(t, h.earningsAccountId!)).toMatchObject({ posted: 0 });
    // The fee-window job later does nothing more.
    await advance(t, 301_000);
    expect((await platform(t, 'REVENUE')) - revenue0).toBe(1000);
    await expect(t.client(c.token).call(api.assignments.tip, { params: { id }, body: { amount: 500 } })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(t.client(c.token).call(api.assignments.confirmPrice, { params: { id }, body: { method: 'CASH' } })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    const pro = await t.client(h.token).call(api.pro.statsToday);
    expect(pro.jobs).toBe(1);
    await expectLedgerSound(t);
  });

  it('switching to cash cancels an open card checkout; a zero total completes without payment', async () => {
    const job = await soloJob(t);
    const { c, assignmentId: id } = job;
    await toPriceProposed(t, job, 2000, 500);
    const card = await t.client(c.token).call(api.assignments.confirmPrice, { params: { id }, body: { method: 'CARD' } });
    await t.client(c.token).call(api.assignments.confirmPrice, { params: { id }, body: { method: 'CASH' } });
    expect((await t.prisma.paymentIntent.findUniqueOrThrow({ where: { id: card.payment!.paymentIntentId } })).status).toBe('CANCELLED');
    const view = await t.client(c.token).call(api.assignments.get, { params: { id } });
    expect(view).toMatchObject({ status: 'COMPLETED', paymentMethod: 'CASH', payment: null });

    await t.reset();
    await setSettings(t, { minCandidates: 0 });
    const free = await soloJob(t);
    await toPriceProposed(t, free, 0, 0);
    const out = await t.client(free.c.token).call(api.assignments.confirmPrice, { params: { id: free.assignmentId }, body: { method: 'CARD' } });
    expect(out.payment).toBeNull();
    expect(out.assignment).toMatchObject({ status: 'COMPLETED', paymentMethod: 'CASH' });
    await expectLedgerSound(t);
  });

  it('auto-complete: a price left unanswered for autoCompleteAfterMin completes as cash (job, and the reconciler after a lost job)', async () => {
    await setSettings(t, { minCandidates: 0, autoCompleteAfterMin: 10 });
    const job = await soloJob(t);
    await toPriceProposed(t, job);
    await advance(t, 10 * 60_000 - 1_000);
    expect((await assignmentRow(t, job.assignmentId)).status).toBe('PRICE_PROPOSED');
    await advance(t, 1_000);
    const a = await assignmentRow(t, job.assignmentId);
    expect(a).toMatchObject({ status: 'COMPLETED', paymentMethod: 'CASH' });
    expect(await t.prisma.notification.count({ where: { userId: job.c.userId, type: 'ASSIGNMENT_COMPLETED' } })).toBe(1);
    // A second run is a no-op.
    expect(await completion(t).autoComplete(job.assignmentId)).toBe(false);
    expect((await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: job.h.handymanId } })).completedCount).toBe(1);

    // Lost timer (server restart): the reconciler repairs it.
    await t.reset();
    await setSettings(t, { minCandidates: 0, autoCompleteAfterMin: 10 });
    const lost = await soloJob(t);
    await toPriceProposed(t, lost);
    t.jobs.clearManual();
    t.clock.advance(11 * 60_000);
    await t.reconciler.tickAll();
    expect((await assignmentRow(t, lost.assignmentId)).status).toBe('COMPLETED');
    await expectLedgerSound(t);
  });

  it('a card payment that succeeds after an auto-complete switches the job to CARD with the guarantee (customer paid by card)', async () => {
    await setSettings(t, { minCandidates: 0, autoCompleteAfterMin: 10 });
    const job = await soloJob(t);
    await toPriceProposed(t, job, 4000, 0);
    const conf = await t.client(job.c.token).call(api.assignments.confirmPrice, { params: { id: job.assignmentId }, body: { method: 'CARD' } });
    await advance(t, 10 * 60_000);
    expect((await assignmentRow(t, job.assignmentId)).paymentMethod).toBe('CASH');
    // The open checkout was cancelled by the cash completion: a late submit does not pay.
    const late = await payWithCard(t, conf.payment!.checkoutUrl).catch(() => null);
    expect(late === null || late.status !== 500).toBe(true);
    expect((await t.prisma.paymentIntent.findUniqueOrThrow({ where: { id: conf.payment!.paymentIntentId } })).status).toBe('CANCELLED');

    // A payment settled concurrently (listener missed) is applied by the reconciler.
    await t.reset();
    await setSettings(t, { minCandidates: 0, autoCompleteAfterMin: 10 });
    const j2 = await soloJob(t);
    await toPriceProposed(t, j2, 4000, 0);
    await advance(t, 10 * 60_000);
    const intent = await t.prisma.paymentIntent.create({
      data: {
        purpose: 'JOB_PAYMENT',
        amount: 4000n,
        status: 'CREATED',
        payerUserId: j2.c.userId,
        walletAccountId: j2.h.earningsAccountId,
        assignmentId: j2.assignmentId,
        createdAt: t.clock.now(),
      },
    });
    await t.app.get(PaymentsService).settle(intent.id, 'SUCCEEDED');
    const a = await assignmentRow(t, j2.assignmentId);
    expect(a).toMatchObject({ status: 'COMPLETED', paymentMethod: 'CARD', paymentIntentId: intent.id });
    expect(a.guaranteeUntil).not.toBeNull();
    await expectLedgerSound(t);
  });

  it('authorization and state errors on provider actions', async () => {
    const job = await soloJob(t);
    const { c, h, assignmentId: id } = job;
    const H = t.client(h.token);
    // The customer (or anyone else) cannot use pro endpoints on it; the pro cannot use customer endpoints.
    await expect(t.client(c.token).call(api.pro.assignment, { params: { id } })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    await expect(H.call(api.assignments.get, { params: { id } })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(H.call(api.assignments.confirmPrice, { params: { id }, body: { method: 'CASH' } })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // Wrong state.
    await expect(H.call(api.pro.enterPrice, { params: { id }, body: { labor: 100, materials: 0 } })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(H.call(api.pro.rateCustomer, { params: { id }, body: { stars: 5 } })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(t.client(c.token).call(api.assignments.rate, { params: { id }, body: { stars: 5 } })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(t.client(c.token).call(api.assignments.confirmPrice, { params: { id }, body: { method: 'CASH' } })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await toArrived(t, job);
    await expect(H.call(api.pro.enRoute, { params: { id }, body: {} })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(H.call(api.pro.arrived, { params: { id } })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    // Blocked user.
    await t.prisma.user.update({ where: { id: h.userId }, data: { status: 'BLOCKED' } });
    t.sessions.invalidateCache();
    await expect(H.call(api.pro.enterPrice, { params: { id }, body: { labor: 100, materials: 0 } })).rejects.toMatchObject({ code: 'USER_BLOCKED', status: 403 });
    expect((await assignmentRow(t, id)).status).toBe('ARRIVED');
    // Unknown ids.
    await expect(t.client(c.token).call(api.assignments.get, { params: { id: '0190a0a0-0000-7000-8000-000000000000' } })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('en route without a location uses the last known position; pro lists by scope', async () => {
    const job = await soloJob(t);
    const H = t.client(job.h.token);
    const pv = await H.call(api.pro.enRoute, { params: { id: job.assignmentId }, body: {} });
    expect(pv.status).toBe('EN_ROUTE');
    expect(pv.route).not.toBeNull();
    const active = await H.call(api.pro.assignments, { query: { scope: 'active' } });
    expect(active.items.map((x) => x.id)).toEqual([job.assignmentId]);
    expect((await H.call(api.pro.assignments, { query: { scope: 'history' } })).items).toEqual([]);
    expect((await H.call(api.pro.assignments)).items).toHaveLength(1);
    await expect(H.call(api.pro.assignments, { query: { cursor: 'garbage' } })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});
