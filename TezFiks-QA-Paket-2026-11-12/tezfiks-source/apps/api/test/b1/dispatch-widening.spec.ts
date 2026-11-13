import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { latLngToCell } from 'h3-js';
import { api, rooms } from '@tezfiks/shared';
import { createTestApp, type TestApp } from '../helpers/app';
import { BAKU, createCompany, createCustomer, createSoloHandyman } from '../helpers/factories';
import { RedisService } from '../../src/infra/redis.service';
import { advance, createRequest, dispatch, goOnline, offersOf, pointInRing, presence, setSettings, touch } from './helpers';

const center = BAKU.center;
const STEP_MS = 30_000; // ringStepSec (no fast-forward: minCandidates = 0)
const WIDE_STEP = 5;

/**
 * BUG-004 regression matrix (QA scenarios A-J): who gets an offer while the search widens.
 * The rule under test: a provider is left out of a request only by the request's own offer history and the
 * eligibility rules, never because presence (Redis) already knows them.
 */
describe('B1 dispatch widening (BUG-004)', () => {
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

  const solo = (data: Parameters<typeof createSoloHandyman>[1] = {}) => createSoloHandyman(t, { balance: 2000, ...data });

  /** Runs ring steps `from`..`to` (one per 30 s), refreshing the presence of `fresh` after each step. */
  async function runSteps(from: number, to: number, fresh: string[] = []): Promise<void> {
    for (let step = from; step <= to; step++) {
      await advance(t, STEP_MS);
      await touch(t, ...fresh);
    }
  }

  async function goOffline(handymanId: string): Promise<void> {
    await t.prisma.handymanProfile.update({ where: { id: handymanId }, data: { isOnline: false } });
    await presence(t).setOffline(handymanId);
  }

  const offersFor = async (requestId: string, handymanId: string) => (await offersOf(t, requestId)).filter((o) => o.handymanId === handymanId);
  const stepOf = async (requestId: string) => (await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: requestId } })).dispatchStep;

  it('A: an eligible online pro inside the initial radius gets the offer at step 0', async () => {
    const c = await createCustomer(t);
    const h = await solo();
    await goOnline(t, h.handymanId, center);
    const req = await createRequest(t, c);
    expect((await offersOf(t, req.id)).map((o) => [o.handymanId, o.step, o.ring, o.status])).toEqual([[h.handymanId, 0, 0, 'SENT']]);
    expect(t.realtime.sentTo(rooms.user(h.userId), 'offer:new')).toHaveLength(1);
  });

  it('B: a pro outside the initial radius gets the offer when the search widens to their ring, not before', async () => {
    const c = await createCustomer(t);
    const h = await solo();
    await goOnline(t, h.handymanId, pointInRing(center, 3));
    const req = await createRequest(t, c);
    await runSteps(1, 2, [h.handymanId]);
    expect(await offersOf(t, req.id)).toHaveLength(0);
    await runSteps(3, 3, [h.handymanId]);
    expect((await offersOf(t, req.id)).map((o) => [o.handymanId, o.step, o.ring, o.status])).toEqual([[h.handymanId, 3, 3, 'SENT']]);
  });

  it('C: a pro who already got the offer is not offered the same request again when the last step sweeps the disk', async () => {
    const c = await createCustomer(t);
    const h = await solo();
    await goOnline(t, h.handymanId, center);
    const req = await createRequest(t, c);
    await runSteps(1, WIDE_STEP, [h.handymanId]);
    expect(await stepOf(req.id)).toBeGreaterThanOrEqual(WIDE_STEP);
    expect((await offersFor(req.id, h.handymanId)).map((o) => [o.step, o.status])).toEqual([[0, 'EXPIRED']]);
    expect(t.realtime.sentTo(rooms.user(h.userId), 'offer:new')).toHaveLength(1);
  });

  it('D: with only ineligible pros online the request still expires and nobody is offered', async () => {
    const c = await createCustomer(t);
    const wrongTrade = await solo({ trades: ['electrical'] });
    const poor = await createSoloHandyman(t, { balance: 999 });
    await goOnline(t, wrongTrade.handymanId, center);
    const req = await createRequest(t, c);
    await goOnline(t, poor.handymanId, center); // late and still not eligible
    await runSteps(1, WIDE_STEP, [wrongTrade.handymanId, poor.handymanId]);
    await advance(t, STEP_MS);
    expect(await offersOf(t, req.id)).toHaveLength(0);
    expect(await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: req.id } })).toMatchObject({ status: 'EXPIRED', isSearching: false });
  });

  it('E: a pro who goes offline during the search gets no offer, at their ring step or at the last step', async () => {
    const c = await createCustomer(t);
    const ring1 = await solo();
    const late = await solo();
    await goOnline(t, ring1.handymanId, pointInRing(center, 1));
    const req = await createRequest(t, c);
    await goOffline(ring1.handymanId);
    await goOnline(t, late.handymanId, center);
    await runSteps(1, 2, [late.handymanId]);
    await goOffline(late.handymanId);
    await runSteps(3, WIDE_STEP);
    expect(await stepOf(req.id)).toBeGreaterThanOrEqual(WIDE_STEP);
    expect(await offersOf(t, req.id)).toHaveLength(0);
  });

  it('F: a pro who comes online before their ring step is offered at that step (normal policy)', async () => {
    const c = await createCustomer(t);
    const h = await solo();
    const req = await createRequest(t, c);
    await runSteps(1, 1);
    await goOnline(t, h.handymanId, pointInRing(center, 2));
    await runSteps(2, 2, [h.handymanId]);
    expect((await offersOf(t, req.id)).map((o) => [o.handymanId, o.step, o.ring])).toEqual([[h.handymanId, 2, 2]]);
  });

  it('F: a pro who comes online in a ring that was already searched is offered at the last step', async () => {
    const c = await createCustomer(t);
    const h = await solo();
    const req = await createRequest(t, c);
    await runSteps(1, 2);
    await goOnline(t, h.handymanId, pointInRing(center, 1));
    await runSteps(3, 4, [h.handymanId]);
    expect(await offersOf(t, req.id)).toHaveLength(0);
    await runSteps(WIDE_STEP, WIDE_STEP, [h.handymanId]);
    expect((await offersOf(t, req.id)).map((o) => [o.handymanId, o.step, o.status])).toEqual([[h.handymanId, WIDE_STEP, 'SENT']]);
  });

  it('F: a late pro standing next to the customer is offered even when their declared service area does not cover the address', async () => {
    const c = await createCustomer(t);
    // Based 9 rings away with a 10 km radius: the service cells do not reach the request cell, the pro's position does.
    const roaming = await solo({ base: pointInRing(center, 9), radiusKm: 10 });
    const requestCell = latLngToCell(center.lat, center.lng, 7);
    expect(await t.prisma.handymanServiceCell.count({ where: { handymanId: roaming.handymanId, cell7: requestCell } })).toBe(0);
    const req = await createRequest(t, c);
    await goOnline(t, roaming.handymanId, center);
    await runSteps(1, WIDE_STEP, [roaming.handymanId]);
    expect((await offersOf(t, req.id)).map((o) => [o.handymanId, o.step, o.status])).toEqual([[roaming.handymanId, WIDE_STEP, 'SENT']]);
  });

  it('QA repro (demo timers, fast-forward on): a pro who goes online at the address 3 s after the request gets the offer and can take the job', async () => {
    await setSettings(t, { minCandidates: 3, ringStepSec: 10, offerTtlSec: 15, noMatchAfterSec: 90 });
    const c = await createCustomer(t);
    const h = await solo({ base: center, radiusKm: 10 });
    const req = await createRequest(t, c);
    await advance(t, 3_000);
    await goOnline(t, h.handymanId, center);
    let offer: Awaited<ReturnType<typeof offersFor>>[number] | undefined;
    for (let sec = 6; sec <= 100 && !offer; sec += 3) {
      await advance(t, 3_000);
      await touch(t, h.handymanId);
      [offer] = await offersFor(req.id, h.handymanId);
    }
    expect(offer).toMatchObject({ status: 'SENT', step: WIDE_STEP });
    expect(await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: req.id } })).toMatchObject({ status: 'SEARCHING', isSearching: true });
    await t.client(h.token).call(api.pro.acceptOffer, { params: { id: offer!.id } });
    expect(await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: req.id } })).toMatchObject({ status: 'ASSIGNED', isSearching: false });
  });

  it('the last step keeps the service-area rule for every position: a covering pro in ring 5 beyond their radius is offered like one outside the disk', async () => {
    const c = await createCustomer(t);
    const inRing5 = await solo({ base: center, radiusKm: 3 });
    const outside = await solo({ base: center, radiusKm: 3 });
    await goOnline(t, inRing5.handymanId, pointInRing(center, 5));
    await goOnline(t, outside.handymanId, pointInRing(center, 7));
    const req = await createRequest(t, c);
    await runSteps(1, 4, [inRing5.handymanId, outside.handymanId]);
    expect(await offersOf(t, req.id)).toHaveLength(0);
    await runSteps(WIDE_STEP, WIDE_STEP);
    expect((await offersOf(t, req.id)).map((o) => o.handymanId).sort()).toEqual([inRing5.handymanId, outside.handymanId].sort());
  });

  it('pros left over by maxOffersPerStep are offered at the last step, nearest first and never twice', async () => {
    await setSettings(t, { maxOffersPerStep: 2 });
    const c = await createCustomer(t);
    const base = pointInRing(center, 0);
    const [near, mid, far] = [await solo(), await solo(), await solo()];
    await goOnline(t, far.handymanId, { lat: base.lat + 0.004, lng: base.lng });
    await goOnline(t, near.handymanId, { lat: base.lat + 0.0005, lng: base.lng });
    await goOnline(t, mid.handymanId, { lat: base.lat + 0.002, lng: base.lng });
    const all = [near.handymanId, mid.handymanId, far.handymanId];
    const req = await createRequest(t, c, { at: base });
    expect((await offersOf(t, req.id)).map((o) => o.handymanId).sort()).toEqual([near.handymanId, mid.handymanId].sort());
    await runSteps(1, 4, all);
    expect(await offersOf(t, req.id)).toHaveLength(2);
    await runSteps(WIDE_STEP, WIDE_STEP, all);
    const offers = await offersOf(t, req.id);
    expect(offers).toHaveLength(3);
    expect(offers.at(-1)).toMatchObject({ handymanId: far.handymanId, step: WIDE_STEP, status: 'SENT' });
  });

  it('a company whose worker comes online after step 0 gets the offer at the next step (companies use the whole disk)', async () => {
    const c = await createCustomer(t);
    const co = await createCompany(t, { trades: ['plumbing'], workers: 1, balance: 5000 });
    const req = await createRequest(t, c);
    expect(await offersOf(t, req.id)).toHaveLength(0);
    await goOnline(t, co.workers[0]!.handymanId, center);
    await runSteps(1, WIDE_STEP, [co.workers[0]!.handymanId]);
    expect((await offersOf(t, req.id)).map((o) => [o.targetType, o.companyId, o.step])).toEqual([['COMPANY', co.companyId, 1]]);
  });

  it('G: the last step run by several workers at once (two job runs and the reconciler) creates one offer per pro', async () => {
    const c = await createCustomer(t);
    const [a, b] = [await solo(), await solo()];
    const req = await createRequest(t, c);
    await runSteps(1, 1);
    await goOnline(t, a.handymanId, center);
    await goOnline(t, b.handymanId, pointInRing(center, 1));
    await runSteps(2, 4, [a.handymanId, b.handymanId]);
    expect(await offersOf(t, req.id)).toHaveLength(0);
    t.clock.advance(STEP_MS + 1_000);
    await Promise.all([dispatch(t).runStep(req.id, WIDE_STEP), dispatch(t).runStep(req.id, WIDE_STEP), dispatch(t).repair()]);
    await t.jobs.runDue();
    const offers = await offersOf(t, req.id);
    expect(offers.map((o) => o.handymanId).sort()).toEqual([a.handymanId, b.handymanId].sort());
    expect(offers.every((o) => o.step === WIDE_STEP)).toBe(true);
    for (const h of [a, b]) expect(t.realtime.sentTo(rooms.user(h.userId), 'offer:new')).toHaveLength(1);
  });

  it('H: after the request is accepted the widening stops: a pro who comes online later gets nothing', async () => {
    const c = await createCustomer(t);
    const [first, late] = [await solo(), await solo()];
    await goOnline(t, first.handymanId, center);
    const req = await createRequest(t, c);
    const [offer] = await offersFor(req.id, first.handymanId);
    await t.client(first.token).call(api.pro.acceptOffer, { params: { id: offer!.id } });
    expect(t.jobs.pending('dispatch.step')).toHaveLength(0);
    await goOnline(t, late.handymanId, center);
    await runSteps(1, WIDE_STEP, [late.handymanId]);
    await dispatch(t).runStep(req.id, WIDE_STEP); // a stray timer must not send offers either
    expect(await offersFor(req.id, late.handymanId)).toHaveLength(0);
    expect(await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: req.id } })).toMatchObject({ status: 'ASSIGNED', isSearching: false });
  });

  it('I: after the customer cancels no further offers are sent, not even by a stray step timer', async () => {
    const c = await createCustomer(t);
    const late = await solo();
    const req = await createRequest(t, c);
    await runSteps(1, 1);
    await t.client(c.token).call(api.requests.cancel, { params: { id: req.id }, body: {} });
    await goOnline(t, late.handymanId, center);
    await runSteps(2, WIDE_STEP, [late.handymanId]);
    await dispatch(t).runStep(req.id, WIDE_STEP);
    expect(await offersOf(t, req.id)).toHaveLength(0);
    expect(t.realtime.sentTo(rooms.user(late.userId), 'offer:new')).toHaveLength(0);
    expect(await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: req.id } })).toMatchObject({ status: 'CANCELLED', isSearching: false });
  });

  it('J: a pro whose presence was stale when their ring was searched is offered at the last step once the heartbeat is back', async () => {
    const c = await createCustomer(t);
    const h = await solo();
    await goOnline(t, h.handymanId, center);
    t.clock.advance(100_000); // no heartbeat for longer than onlineStaleSec (90 s)
    const req = await createRequest(t, c);
    expect(await offersOf(t, req.id)).toHaveLength(0);
    await touch(t, h.handymanId);
    await runSteps(1, 4, [h.handymanId]);
    expect(await offersOf(t, req.id)).toHaveLength(0);
    await runSteps(WIDE_STEP, WIDE_STEP, [h.handymanId]);
    expect((await offersOf(t, req.id)).map((o) => [o.handymanId, o.step])).toEqual([[h.handymanId, WIDE_STEP]]);
  });

  it('J: a lost presence hash (expired key, stale cell member) sends no offer and breaks nothing; the next heartbeat restores the pro', async () => {
    const c = await createCustomer(t);
    const h = await solo();
    await goOnline(t, h.handymanId, center);
    const redis = t.app.get(RedisService);
    await redis.client.del(redis.key('hm', h.handymanId)); // the hash expired, the cell ZSET still lists the pro
    const req = await createRequest(t, c);
    await runSteps(1, 3);
    expect(await offersOf(t, req.id)).toHaveLength(0);
    await touch(t, h.handymanId); // heartbeat: the entry is rebuilt from the DB (still online there)
    await runSteps(4, WIDE_STEP, [h.handymanId]);
    expect((await offersOf(t, req.id)).map((o) => [o.handymanId, o.step, o.status])).toEqual([[h.handymanId, WIDE_STEP, 'SENT']]);
  });

  // ---- After the plan: the final sweep repeats on the ring-step grid until the search ends. ----
  // With nobody around the fast-forward finishes the six plan steps in 15 s while the search runs for 180 s: a pro who
  // opens the app during the rest of the search used to get nothing.

  const request = (id: string) => t.prisma.serviceRequest.findUniqueOrThrow({ where: { id } });
  const searchEvents = (id: string) =>
    t.realtime.sentTo(rooms.request(id), 'request:search').map((e) => e.payload as { step: number; wide: boolean; offersSent: number });

  /** Production timers with fast-forward and nobody around: 18 s after the request the plan is over. */
  async function exhaustedPlan() {
    await setSettings(t, { minCandidates: 3 });
    const c = await createCustomer(t);
    const req = await createRequest(t, c);
    for (let sec = 3; sec <= 18; sec += 3) await advance(t, 3_000);
    expect(await stepOf(req.id)).toBe(WIDE_STEP);
    return { c, req, started: (await request(req.id)).searchStartedAt!.getTime() };
  }

  it('late arrival: a pro who comes online after the last plan step is offered at the next sweep', async () => {
    const { req, started } = await exhaustedPlan();
    expect(t.jobs.pending('dispatch.step').map((j) => j.runAt.getTime())).toEqual([started + 30_000]);
    const h = await solo();
    await advance(t, 2_000); // 20 s after the request
    await goOnline(t, h.handymanId, center);
    await dispatch(t).runStep(req.id, WIDE_STEP + 3); // a sweep asked for before its time does nothing
    expect(await stepOf(req.id)).toBe(WIDE_STEP);
    expect(await offersOf(t, req.id)).toHaveLength(0);

    await advance(t, 10_000); // 30 s: the first sweep
    expect((await offersOf(t, req.id)).map((o) => [o.handymanId, o.step, o.ring, o.status])).toEqual([
      [h.handymanId, WIDE_STEP + 1, 5, 'SENT'],
    ]);
    expect(await request(req.id)).toMatchObject({ status: 'SEARCHING', isSearching: true });
    // The customer still sees the last plan step (wide), now with one offer counted.
    expect(searchEvents(req.id)).toHaveLength(7);
    expect(searchEvents(req.id).at(-1)).toMatchObject({ step: WIDE_STEP, wide: true, offersSent: 1 });
    expect((await t.client(h.token).call(api.pro.offers)).items).toHaveLength(1);
    expect(t.jobs.pending('dispatch.step').map((j) => j.runAt.getTime())).toEqual([started + 60_000]);
  });

  it('sweeps never offer the same pro twice, stay silent when nobody new is eligible, and the request still expires', async () => {
    const { c, req } = await exhaustedPlan();
    const h = await solo();
    await goOnline(t, h.handymanId, center);
    await advance(t, 12_000); // 30 s
    for (let sec = 60; sec <= 180; sec += 30) {
      await touch(t, h.handymanId);
      await advance(t, 30_000);
    }
    expect((await offersFor(req.id, h.handymanId)).map((o) => [o.step, o.status])).toEqual([[WIDE_STEP + 1, 'EXPIRED']]);
    expect(t.realtime.sentTo(rooms.user(h.userId), 'offer:new')).toHaveLength(1);
    expect(searchEvents(req.id)).toHaveLength(7); // six plan steps and the one sweep that sent an offer
    expect(await request(req.id)).toMatchObject({ status: 'EXPIRED', isSearching: false, dispatchStep: WIDE_STEP + 5 });
    expect(t.jobs.pending('dispatch.step')).toHaveLength(0);
    expect(await t.prisma.notification.count({ where: { userId: c.userId, type: 'REQUEST_EXPIRED' } })).toBe(1);
  });

  it('without fast-forward the plan fills the search window: no sweep follows the wide step (production timers)', async () => {
    const c = await createCustomer(t);
    const req = await createRequest(t, c);
    await runSteps(1, WIDE_STEP);
    expect(await stepOf(req.id)).toBe(WIDE_STEP + 5) /* the wide step ran at grid point 5 (150 s) */;
    expect(t.jobs.pending('dispatch.step')).toHaveLength(0);
  });

  it('cancelling after the plan ended removes the pending sweep; a stray sweep sends nothing', async () => {
    const { c, req } = await exhaustedPlan();
    expect(t.jobs.pending('dispatch.step')).toHaveLength(1);
    await t.client(c.token).call(api.requests.cancel, { params: { id: req.id }, body: {} });
    expect(t.jobs.pending('dispatch.step')).toHaveLength(0);
    const h = await solo();
    await goOnline(t, h.handymanId, center);
    await advance(t, 42_000); // 60 s
    await dispatch(t).runStep(req.id, WIDE_STEP + 2);
    expect(await offersOf(t, req.id)).toHaveLength(0);
    expect(await request(req.id)).toMatchObject({ status: 'CANCELLED', dispatchStep: WIDE_STEP });
  });

  it('the reconciler runs an overdue sweep when its timer was lost, once, and the next sweep is scheduled again', async () => {
    const { req } = await exhaustedPlan();
    t.jobs.clearManual();
    const h = await solo();
    await goOnline(t, h.handymanId, center);
    t.clock.advance(15_000); // 33 s: the 30 s sweep is overdue
    await touch(t, h.handymanId);
    await t.reconciler.tickAll();
    await t.reconciler.tickAll();
    expect((await offersFor(req.id, h.handymanId)).map((o) => o.step)).toEqual([WIDE_STEP + 1]);
    expect(await stepOf(req.id)).toBe(WIDE_STEP + 1);
    expect(t.jobs.pending('dispatch.step')).toHaveLength(1);
  });

  it('QA diag-late-online 30 (demo timers): a pro who goes online 30 s after the request gets the offer at the next sweep', async () => {
    await setSettings(t, { minCandidates: 3, ringStepSec: 10, offerTtlSec: 15, noMatchAfterSec: 90 });
    const c = await createCustomer(t);
    const h = await solo();
    const req = await createRequest(t, c);
    for (let sec = 3; sec <= 30; sec += 3) await advance(t, 3_000);
    await goOnline(t, h.handymanId, center);
    let offer: Awaited<ReturnType<typeof offersFor>>[number] | undefined;
    for (let sec = 33; sec <= 60 && !offer; sec += 3) {
      await advance(t, 3_000);
      await touch(t, h.handymanId);
      [offer] = await offersFor(req.id, h.handymanId);
    }
    expect(offer).toMatchObject({ status: 'SENT', ring: 5 });
    const started = (await request(req.id)).searchStartedAt!.getTime();
    expect(offer!.sentAt.getTime() - started).toBeLessThan(45_000); // the 40 s sweep, seen at the 42 s tick
    await t.client(h.token).call(api.pro.acceptOffer, { params: { id: offer!.id } });
    expect(await request(req.id)).toMatchObject({ status: 'ASSIGNED', isSearching: false });
    expect(t.jobs.pending('dispatch.step')).toHaveLength(0);
  });

  it('emergency searches sweep on their own ring step after their plan (k1..k4 and the wide step)', async () => {
    await setSettings(t, { minCandidates: 3 });
    const c = await createCustomer(t, { balance: 1000 });
    const req = await createRequest(t, c, { timing: 'EMERGENCY' });
    for (let sec = 3; sec <= 15; sec += 3) await advance(t, 3_000);
    expect(await stepOf(req.id)).toBe(4); // the emergency wide step
    const h = await solo();
    await goOnline(t, h.handymanId, center);
    await advance(t, 5_000); // 20 s = emergencyRingStepSec
    expect((await offersOf(t, req.id)).map((o) => [o.handymanId, o.step, o.status])).toEqual([[h.handymanId, 5, 'SENT']]);
  });
});
