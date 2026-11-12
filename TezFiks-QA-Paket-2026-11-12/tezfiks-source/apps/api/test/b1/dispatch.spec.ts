import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { gridDisk, latLngToCell } from 'h3-js';
import { api, rooms, type OfferView } from '@tezfiks/shared';
import { createTestApp, type TestApp } from '../helpers/app';
import { BAKU, createCompany, createCustomer, createSoloHandyman } from '../helpers/factories';
import { addDevice, advance, createRequest, expectLedgerSound, goOnline, offersOf, pointInRing, pushLog, setSettings, touch } from './helpers';

const center = BAKU.center;
const cell7 = (p: { lat: number; lng: number }) => latLngToCell(p.lat, p.lng, 7);

describe('B1 dispatch engine (H3 rings)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
    pushLog(t).clear();
    await setSettings(t, { minCandidates: 0 });
  });

  it('step 0 offers only the centre cell; a ring-1 pro gets the offer at step 1 and a ring-2 pro only at step 2', async () => {
    const c = await createCustomer(t);
    const h0 = await createSoloHandyman(t, { balance: 2000 });
    const h1 = await createSoloHandyman(t, { balance: 2000 });
    const h2 = await createSoloHandyman(t, { balance: 2000 });
    await goOnline(t, h0.handymanId, center);
    await goOnline(t, h1.handymanId, pointInRing(center, 1));
    await goOnline(t, h2.handymanId, pointInRing(center, 2));
    const req = await createRequest(t, c);

    let offers = await offersOf(t, req.id);
    expect(offers.map((o) => [o.handymanId, o.step, o.ring])).toEqual([[h0.handymanId, 0, 0]]);
    expect(t.realtime.sentTo(rooms.user(h0.userId), 'offer:new')).toHaveLength(1);

    await advance(t, 20_000);
    expect(await offersOf(t, req.id)).toHaveLength(1);

    await advance(t, 10_000);
    offers = await offersOf(t, req.id);
    expect(offers.map((o) => [o.handymanId, o.step, o.ring])).toEqual([
      [h0.handymanId, 0, 0],
      [h1.handymanId, 1, 1],
    ]);
    expect(offers.find((o) => o.handymanId === h2.handymanId)).toBeUndefined();

    await advance(t, 30_000);
    offers = await offersOf(t, req.id);
    expect(offers.find((o) => o.handymanId === h2.handymanId)).toMatchObject({ step: 2, ring: 2, status: 'SENT' });

    const search = t.realtime.sentTo(rooms.request(req.id), 'request:search').map((e) => e.payload as { step: number; cells: string[] });
    expect(search.map((s) => s.step)).toEqual([0, 1, 2]);
    expect(search.map((s) => s.cells.length)).toEqual([1, 7, 19]);
    expect(t.realtime.sentTo(rooms.user(c.userId), 'request:search')).toHaveLength(3);
  });

  it('offers are sorted by distance and capped at maxOffersPerStep', async () => {
    await setSettings(t, { maxOffersPerStep: 2 });
    const c = await createCustomer(t);
    const near = await createSoloHandyman(t, { balance: 2000 });
    const mid = await createSoloHandyman(t, { balance: 2000 });
    const far = await createSoloHandyman(t, { balance: 2000 });
    const base = pointInRing(center, 0); // the cell centre, so every test point stays inside the same res-7 cell
    await goOnline(t, far.handymanId, { lat: base.lat + 0.004, lng: base.lng });
    await goOnline(t, near.handymanId, { lat: base.lat + 0.0005, lng: base.lng });
    await goOnline(t, mid.handymanId, { lat: base.lat + 0.002, lng: base.lng });
    expect(cell7({ lat: base.lat + 0.004, lng: base.lng })).toBe(cell7(base));
    const req = await createRequest(t, c, { at: base });
    const offers = await offersOf(t, req.id);
    expect(offers.map((o) => o.handymanId).sort()).toEqual([near.handymanId, mid.handymanId].sort());
    expect(offers.every((o) => (o.distanceM ?? 0) < 300)).toBe(true);
  });

  it('min-candidates fast-forward: below minCandidates the next ring follows after 3 s', async () => {
    await setSettings(t, { minCandidates: 3 });
    const c = await createCustomer(t);
    const req = await createRequest(t, c);
    const [next] = t.jobs.pending('dispatch.step');
    expect(next!.runAt.getTime() - t.clock.nowMs()).toBeLessThanOrEqual(3_000);
    expect(next!.runAt.getTime() - t.clock.nowMs()).toBeGreaterThan(2_000);
    await advance(t, 3_000);
    expect((await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: req.id } })).dispatchStep).toBe(1);

    const c2 = await createCustomer(t);
    for (let i = 0; i < 3; i++) {
      const h = await createSoloHandyman(t, { balance: 2000 });
      await goOnline(t, h.handymanId, center);
    }
    const req2 = await createRequest(t, c2);
    expect(await offersOf(t, req2.id)).toHaveLength(3);
    const job = t.jobs.pending('dispatch.step').find((j) => (j.data as { requestId: string }).requestId === req2.id)!;
    const started = (await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: req2.id } })).searchStartedAt!;
    expect(job.runAt.getTime()).toBe(started.getTime() + 30_000);
  });

  it('eligibility filters: unapproved, busy, no trade, low balance, blocked user, stale presence, out of radius are never offered', async () => {
    const c = await createCustomer(t);
    const stale = await createSoloHandyman(t, { balance: 2000 });
    await goOnline(t, stale.handymanId, center);
    t.clock.advance(100_000); // older than onlineStaleSec (90 s)

    const ok = await createSoloHandyman(t, { balance: 2000 });
    const pending = await createSoloHandyman(t, { balance: 2000, status: 'PENDING_REVIEW' });
    const busy = await createSoloHandyman(t, { balance: 2000 });
    const noTrade = await createSoloHandyman(t, { balance: 2000, trades: ['electrical'] });
    const poor = await createSoloHandyman(t, { balance: 999 });
    const blocked = await createSoloHandyman(t, { balance: 2000 });
    const ring1Far = await createSoloHandyman(t, { balance: 2000, radiusKm: 1 });
    const ring1Ok = await createSoloHandyman(t, { balance: 2000 });
    await t.prisma.user.update({ where: { id: blocked.userId }, data: { status: 'BLOCKED' } });
    for (const h of [ok, pending, busy, noTrade, poor, blocked]) await goOnline(t, h.handymanId, center);
    await goOnline(t, ring1Far.handymanId, pointInRing(center, 1));
    await goOnline(t, ring1Ok.handymanId, pointInRing(center, 1, 1));

    // `busy` already works on another job.
    const other = await createCustomer(t);
    const otherReq = await createRequest(t, other);
    await t.prisma.offer.deleteMany({ where: { requestId: otherReq.id } });
    const slot = await t.prisma.requestSlot.findFirstOrThrow({ where: { requestId: otherReq.id } });
    await t.prisma.assignment.create({
      data: {
        requestId: otherReq.id,
        slotId: slot.id,
        providerType: 'SOLO',
        handymanId: busy.handymanId,
        acceptedByUserId: busy.userId,
        status: 'EN_ROUTE',
        acceptedAt: t.clock.now(),
        freeCancelUntil: t.clock.now(),
      },
    });
    await t.prisma.serviceRequest.update({ where: { id: otherReq.id }, data: { isSearching: false, status: 'IN_PROGRESS' } });

    const req = await createRequest(t, c);
    expect((await offersOf(t, req.id)).map((o) => o.handymanId)).toEqual([ok.handymanId]);
    await advance(t, 30_000);
    const ids = (await offersOf(t, req.id)).map((o) => o.handymanId);
    expect(ids).toContain(ring1Ok.handymanId);
    for (const h of [stale, pending, busy, noTrade, poor, blocked, ring1Far]) expect(ids).not.toContain(h.handymanId);
  });

  it('company offers carry candidate workers; company eligibility needs balance, the trade and an online free worker', async () => {
    const c = await createCustomer(t);
    const co = await createCompany(t, { trades: ['plumbing'], workers: 2, balance: 5000 });
    const poorCo = await createCompany(t, { trades: ['plumbing'], workers: 1, balance: 500 });
    const offlineCo = await createCompany(t, { trades: ['plumbing'], workers: 1, balance: 5000 });
    const wrongTradeCo = await createCompany(t, { trades: ['electrical'], workers: 1, balance: 5000 });
    for (const w of co.workers) await goOnline(t, w.handymanId, center);
    await goOnline(t, poorCo.workers[0]!.handymanId, center);
    await goOnline(t, wrongTradeCo.workers[0]!.handymanId, center);
    void offlineCo;

    const req = await createRequest(t, c);
    const offers = await offersOf(t, req.id);
    expect(offers.map((o) => [o.targetType, o.companyId])).toEqual([['COMPANY', co.companyId]]);
    // A company worker is never offered a job as a solo handyman.
    expect(offers.some((o) => o.handymanId)).toBe(false);

    const sent = t.realtime.sentTo(rooms.company(co.companyId), 'offer:new');
    expect(sent).toHaveLength(1);
    const view = sent[0]!.payload as OfferView;
    expect(view).toMatchObject({ target: 'COMPANY', companyId: co.companyId, fee: 1000, slotsOpen: 1 });
    expect(view.candidateWorkers.map((w) => w.handymanId).sort()).toEqual(co.workers.map((w) => w.handymanId).sort());
    for (const w of view.candidateWorkers) expect(w).toMatchObject({ online: true, busy: false, hasTrade: true, firstName: expect.any(String) });
    expect(await t.prisma.notification.count({ where: { userId: co.manager.userId, type: 'OFFER_NEW' } })).toBe(1);
    for (const w of co.workers) expect(await t.prisma.notification.count({ where: { userId: w.userId, type: 'OFFER_NEW' } })).toBe(0);

    const list = await t.client(co.manager.token).call(api.company.offers, { params: { companyId: co.companyId } });
    expect(list.items.map((o) => o.id)).toEqual([offers[0]!.id]);
    await expect(t.client(co.workers[0]!.token).call(api.company.offers, { params: { companyId: co.companyId } })).rejects.toMatchObject({
      code: 'NOT_COMPANY_MANAGER',
      status: 403,
    });
    await expect(t.client(poorCo.manager.token).call(api.company.offers, { params: { companyId: co.companyId } })).rejects.toMatchObject({
      code: 'NOT_COMPANY_MANAGER',
    });
  });

  it('provider preference: COMPANY excludes solos, INDIVIDUAL excludes companies', async () => {
    const solo = await createSoloHandyman(t, { balance: 2000 });
    const co = await createCompany(t, { trades: ['plumbing'], workers: 1, balance: 5000 });
    await goOnline(t, solo.handymanId, center);
    await goOnline(t, co.workers[0]!.handymanId, center);
    const cust = await createCustomer(t, { type: 'COMPANY' });
    const onlyCompanies = await createRequest(t, cust, { providerPreference: 'COMPANY' });
    expect((await offersOf(t, onlyCompanies.id)).map((o) => o.targetType)).toEqual(['COMPANY']);
    const onlySolos = await createRequest(t, cust, { providerPreference: 'INDIVIDUAL' });
    expect((await offersOf(t, onlySolos.id)).map((o) => o.targetType)).toEqual(['HANDYMAN']);
    const any = await createRequest(t, cust, { providerPreference: 'ANY' });
    expect((await offersOf(t, any.id)).map((o) => o.targetType).sort()).toEqual(['COMPANY', 'HANDYMAN']);
  });

  it('offer expiry: SENT -> EXPIRED with offer:closed, and it leaves the pro offers list', async () => {
    const c = await createCustomer(t);
    const h = await createSoloHandyman(t, { balance: 2000 });
    await goOnline(t, h.handymanId, center);
    const req = await createRequest(t, c);
    const offersNow = await t.client(h.token).call(api.pro.offers);
    expect(offersNow.items).toHaveLength(1);
    expect(offersNow.items[0]).toMatchObject({ requestId: req.id, status: 'SENT', fee: 1000 });
    await advance(t, 30_000);
    const [o] = await offersOf(t, req.id);
    expect(o).toMatchObject({ status: 'EXPIRED', closeReason: 'EXPIRED' });
    expect(t.realtime.sentTo(rooms.user(h.userId), 'offer:closed').map((e) => e.payload)).toEqual([
      { offerId: o!.id, requestId: req.id, reason: 'EXPIRED' },
    ]);
    expect((await t.client(h.token).call(api.pro.offers)).items).toEqual([]);
  });

  it('the wide step adds pros whose service area covers the request cell even when they are outside ring 5', async () => {
    const c = await createCustomer(t);
    const farAway = pointInRing(center, 7);
    const covering = await createSoloHandyman(t, { balance: 2000, base: center, radiusKm: 10 });
    const notCovering = await createSoloHandyman(t, { balance: 2000, base: farAway, radiusKm: 3 });
    await goOnline(t, covering.handymanId, farAway);
    await goOnline(t, notCovering.handymanId, farAway);
    const req = await createRequest(t, c);
    for (let step = 1; step <= 4; step++) {
      await advance(t, 30_000);
      await touch(t, covering.handymanId, notCovering.handymanId);
    }
    expect(await offersOf(t, req.id)).toHaveLength(0);
    await advance(t, 30_000);
    const offers = await offersOf(t, req.id);
    expect(offers.map((o) => [o.handymanId, o.step, o.ring])).toEqual([[covering.handymanId, 5, 5]]);
    const last = t.realtime.sentTo(rooms.request(req.id), 'request:search').at(-1)!.payload as { wide: boolean; cells: string[] };
    expect(last.wide).toBe(true);
    expect(last.cells.length).toBe(gridDisk(cell7(center), 5).length);
  });

  it('search end: SENT offers closed, OPEN slots UNFILLED, emergency holds released, request EXPIRED + REQUEST_EXPIRED', async () => {
    const c = await createCustomer(t, { balance: 1000 });
    const req = await createRequest(t, c, { timing: 'EMERGENCY', slots: 2 });
    expect(await t.ledger.balance(c.walletAccountId)).toMatchObject({ held: 1000, available: 0 });
    for (let i = 0; i < 9; i++) await advance(t, 20_000);
    const r = await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: req.id }, include: { slots: true } });
    expect(r).toMatchObject({ status: 'EXPIRED', isSearching: false });
    expect(r.slots.map((s) => s.status)).toEqual(['UNFILLED', 'UNFILLED']);
    expect(await t.prisma.hold.count({ where: { requestId: req.id, status: 'RELEASED' } })).toBe(2);
    expect(await t.ledger.balance(c.walletAccountId)).toEqual({ posted: 1000, held: 0, available: 1000 });
    expect(await t.prisma.notification.count({ where: { userId: c.userId, type: 'REQUEST_EXPIRED' } })).toBe(1);
    expect(t.realtime.sentTo(rooms.request(req.id), 'request:updated').at(-1)!.payload).toEqual({ requestId: req.id, status: 'EXPIRED' });
    const detail = await t.client(c.token).call(api.requests.get, { params: { id: req.id } });
    expect(detail).toMatchObject({ status: 'EXPIRED', canCancel: false, search: null, emergencyFee: { perSlot: 500, total: 1000, captured: 0 } });
    await expectLedgerSound(t);
  });

  it('the reconciler repairs lost timers: overdue offers expire, overdue steps run, overdue searches end', async () => {
    const c = await createCustomer(t);
    const h = await createSoloHandyman(t, { balance: 2000 });
    await goOnline(t, h.handymanId, center);
    const req = await createRequest(t, c);
    t.jobs.clearManual();
    t.clock.advance(31_000);
    await t.reconciler.tickAll();
    expect((await offersOf(t, req.id))[0]).toMatchObject({ status: 'EXPIRED' });
    expect((await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: req.id } })).dispatchStep).toBe(1);
    t.jobs.clearManual();
    t.clock.advance(200_000);
    await t.reconciler.tickAll();
    expect(await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: req.id } })).toMatchObject({ status: 'EXPIRED', isSearching: false });
  });

  it('privacy: offers, OFFER_NEW notifications and push payloads carry no phone and no flat details', async () => {
    const c = await createCustomer(t, { firstName: 'Nizami', lastName: 'Talıbov' });
    const h = await createSoloHandyman(t, { balance: 2000 });
    await addDevice(t, h.userId, 'PRO');
    await goOnline(t, h.handymanId, center);
    const req = await createRequest(t, c, { description: 'Kran axır, zəng edin 050 123 45 67 deyə yazmayın' });
    const socket = t.realtime.sentTo(rooms.user(h.userId), 'offer:new')[0]!.payload as OfferView;
    const listed = (await t.client(h.token).call(api.pro.offers)).items[0]!;
    const notif = await t.prisma.notification.findFirstOrThrow({ where: { userId: h.userId, type: 'OFFER_NEW' } });
    const pushes = pushLog(t).sentTo(h.userId, 'OFFER_NEW');
    expect(pushes).toHaveLength(1);
    const push = pushes[0]!.message;
    expect(push).toMatchObject({ priority: 'high', channelId: 'offers_v1', collapseKey: 'offer' });
    expect(push.ttlSec).toBeGreaterThan(25);
    expect(push.ttlSec).toBeLessThanOrEqual(30);
    expect(push.data).toEqual({ offerId: listed.id, requestId: req.id, expiresAt: listed.expiresAt });

    for (const payload of [socket, listed, notif.data, push]) {
      const json = JSON.stringify(payload);
      expect(json).not.toContain(c.phone);
      expect(json).not.toContain(c.phone.slice(4));
      expect(json).not.toContain('050 123 45 67');
      for (const secret of ['mənzil 45', '2-ci giriş', 'domofon', 'Qapını döymək', '"floor"', 'apartment', 'entrance', 'intercom']) {
        expect(json).not.toContain(secret);
      }
    }
    expect(listed.customer).toEqual({ firstName: 'Nizami', lastInitial: 'T.', ratingAvg: null, ratingCount: 0, type: 'INDIVIDUAL', companyName: null });
    expect(listed.address).toEqual({
      district: 'Səbail rayonu',
      street: 'Nizami küçəsi',
      area: 'Nizami küçəsi 10, Səbail rayonu',
      lat: Math.round(center.lat * 1000) / 1000,
      lng: Math.round(center.lng * 1000) / 1000,
    });
    expect(listed.descriptionShort.length).toBeLessThanOrEqual(140);
  });
});
