import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, decodePolyline, haversineMeters, pathLengthMeters, type LatLng } from '@tezfiks/shared';
import type { TestApp } from '../helpers/app';
import { BAKU, adminToken, categoryId, createCompany, createCustomer, createSoloHandyman } from '../helpers/factories';
import { OffersService } from '../../src/modules/requests/offers.service';
import { PresenceService } from '../../src/modules/realtime/presence.service';
import { botPosition } from '../../src/modules/demo/demo-simulator.service';
import { armSimulator, createDemoApp, expectLedgerBalanced, runSeconds, runUntil, simulator } from './helpers';

describe('demo simulator (bots accept, drive, arrive and price through the real services)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createDemoApp();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
    await armSimulator(t);
  });

  const address = (p: LatLng) => ({ lat: p.lat, lng: p.lng, formatted: 'Atatürk prospekti 12, Nərimanov', street: 'Atatürk prospekti', building: '12' });

  async function spawnBot(opts: { center?: LatLng; radiusKm?: number; trades?: string[]; companyId?: string } = {}) {
    const { token } = await adminToken(t);
    const tradeIds = await Promise.all((opts.trades ?? ['plumbing']).map((s) => categoryId(t, s)));
    await t.client(token).call(api.admin.demoSpawnBots, {
      body: { count: 1, radiusKm: opts.radiusKm ?? 0.3, center: opts.center ?? BAKU.center, tradeIds, ...(opts.companyId ? { companyId: opts.companyId } : {}) },
    });
    const bots = await t.prisma.handymanProfile.findMany({ where: { isBot: true }, orderBy: { createdAt: 'desc' } });
    return { bot: bots[0]!, adminToken: token };
  }

  async function request(customerToken: string, at: LatLng, extra: Record<string, unknown> = {}) {
    return t.client(customerToken).call(api.requests.create, {
      body: { categoryId: await categoryId(t, 'plumbing'), description: 'Mətbəxdə kran axır', timing: 'NOW', address: address(at), ...extra },
    });
  }

  const assignmentOf = (requestId: string) => t.prisma.assignment.findFirst({ where: { requestId }, orderBy: { id: 'desc' } });

  it('arms one tick job per second and re-arms after a lost chain through the reconciler', async () => {
    expect(t.jobs.pending('demo.tick')).toHaveLength(1);
    await armSimulator(t); // same second: replaced, not duplicated
    expect(t.jobs.pending('demo.tick')).toHaveLength(1);
    await runSeconds(t, 3);
    expect(t.jobs.pending('demo.tick')).toHaveLength(1);
    t.jobs.clearManual(); // e.g. a restart lost the delayed jobs
    await t.reconciler.tickAll();
    expect(t.jobs.pending('demo.tick')).toHaveLength(1);
    expect((await simulator(t).tick()).ran).toBe(true);
  });

  it('drives a bot from the offer to the price proposal (accept delay, live pings, contact unlock, arrival, price)', async () => {
    const { bot } = await spawnBot();
    const customer = await createCustomer(t, { balance: 5000 });
    const dest = BAKU.narimanov;
    const req = await request(customer.token, dest);

    await runUntil(t, async () => !!(await t.prisma.offer.findFirst({ where: { requestId: req.id, handymanId: bot.id } })), 120);
    const offer = await t.prisma.offer.findFirstOrThrow({ where: { requestId: req.id, handymanId: bot.id } });
    await runUntil(t, async () => !!(await assignmentOf(req.id)), 30);
    const accepted = (await assignmentOf(req.id))!;
    expect(accepted.handymanId).toBe(bot.id);
    // acceptDelaySec = 4 after the offer was sent (the simulator polls once per second).
    const delayMs = accepted.acceptedAt.getTime() - offer.sentAt.getTime();
    expect(delayMs).toBeGreaterThanOrEqual(4000);
    expect(delayMs).toBeLessThan(6500);
    expect((await t.prisma.offer.findUniqueOrThrow({ where: { id: offer.id } })).status).toBe('ACCEPTED');
    expect(await t.ledger.balance(bot.walletAccountId!)).toMatchObject({ held: 1000, available: 9000 });

    await runUntil(t, async () => (await assignmentOf(req.id))!.status === 'EN_ROUTE', 30);
    const enRoute = (await assignmentOf(req.id))!;
    expect(enRoute.enRouteAt!.getTime() - accepted.acceptedAt.getTime()).toBeGreaterThanOrEqual(4000);
    expect(enRoute.routePolyline).toBeTruthy();
    expect(enRoute.contactUnlockedAt).toBeNull();
    const pathLen = pathLengthMeters([...decodePolyline(enRoute.routePolyline!), dest]);

    // Live pings every 2 s reach the customer; the contact unlocks while still driving (ETA <= 300 s).
    const before = t.realtime.sentTo(`user:${customer.userId}`, 'assignment:location').length;
    await runSeconds(t, 10);
    const pings = t.realtime.sentTo(`user:${customer.userId}`, 'assignment:location').length - before;
    expect(pings).toBeGreaterThanOrEqual(4);
    expect(pings).toBeLessThanOrEqual(6);
    const mid = (await assignmentOf(req.id))!;
    expect(mid.status).toBe('EN_ROUTE');
    // The bot spawns at a random point within radiusKm of the centre, so progress is measured from where its route starts
    // (comparing with BAKU.center failed whenever the bot spawned on the far side). 10 s at 40 km/h is about 110 m.
    const routeStart = decodePolyline(enRoute.routePolyline!)[0]!;
    const progressM = haversineMeters(routeStart, dest) - haversineMeters({ lat: mid.lastLat!, lng: mid.lastLng! }, dest);
    expect(progressM).toBeGreaterThan(50);
    await runUntil(t, async () => !!(await assignmentOf(req.id))!.contactUnlockedAt, 600);
    expect((await assignmentOf(req.id))!.status).toBe('EN_ROUTE');

    await runUntil(t, async () => (await assignmentOf(req.id))!.status === 'ARRIVED', 900);
    const arrived = (await assignmentOf(req.id))!;
    const driveSec = (arrived.arrivedAt!.getTime() - arrived.enRouteAt!.getTime()) / 1000;
    const expected = pathLen / (40 / 3.6);
    expect(Math.abs(driveSec - expected)).toBeLessThan(4);
    expect(haversineMeters({ lat: arrived.lastLat!, lng: arrived.lastLng! }, dest)).toBeLessThan(10);
    const live = await t.app.get(PresenceService).get(bot.id);
    expect(haversineMeters({ lat: live!.lat!, lng: live!.lng! }, dest)).toBeLessThan(10);

    await runUntil(t, async () => (await assignmentOf(req.id))!.status === 'PRICE_PROPOSED', 30);
    const priced = (await assignmentOf(req.id))!;
    expect(priced.priceProposedAt!.getTime() - arrived.arrivedAt!.getTime()).toBeGreaterThanOrEqual(4000);
    expect(Number(priced.laborAmount)).toBe(3500);
    expect(Number(priced.materialsAmount)).toBe(1000);
    expect(Number(priced.totalAmount)).toBe(4500);
    expect(priced.priceEnteredByUserId).toBe(bot.userId);
    // Same notifications as for a human handyman.
    for (const type of ['ASSIGNMENT_EN_ROUTE', 'ASSIGNMENT_NEAR', 'ASSIGNMENT_ARRIVED', 'PRICE_PROPOSED'] as const) {
      expect(await t.prisma.notification.count({ where: { userId: customer.userId, type } })).toBe(1);
    }
    // The customer pays cash: the job completes like any other.
    await t.client(customer.token).call(api.assignments.confirmPrice, { params: { id: priced.id }, body: { method: 'CASH' } });
    expect((await assignmentOf(req.id))!.status).toBe('COMPLETED');
    await runSeconds(t, 5);
    expect(await t.ledger.balance(bot.walletAccountId!)).toMatchObject({ posted: 9000, held: 0 });
    await expectLedgerBalanced(t);
  });

  it('continues a route exactly where it was after a restart (state comes from Postgres and the Clock)', async () => {
    const { bot } = await spawnBot();
    const customer = await createCustomer(t, { balance: 5000 });
    const dest = BAKU.narimanov;
    const req = await request(customer.token, dest);
    await runUntil(t, async () => (await assignmentOf(req.id))?.status === 'EN_ROUTE', 200);
    const a = (await assignmentOf(req.id))!;
    const path = [...decodePolyline(a.routePolyline!), dest];
    await runSeconds(t, 30);

    // "Restart": every pending timer is lost and nothing ticks for 40 s.
    t.jobs.clearManual();
    const frozen = (await assignmentOf(req.id))!;
    t.clock.advance(40_000);
    expect((await assignmentOf(req.id))!.lastLocationAt!.getTime()).toBe(frozen.lastLocationAt!.getTime());
    // The reconciler re-arms the simulator; the next tick puts the bot where 70+ s of driving brings it.
    await t.reconciler.tickAll();
    await runSeconds(t, 1);
    const resumed = (await assignmentOf(req.id))!;
    const expectedPos = botPosition(path, 40, t.clock.nowMs() - a.enRouteAt!.getTime()).at;
    expect(haversineMeters({ lat: resumed.lastLat!, lng: resumed.lastLng! }, expectedPos)).toBeLessThan(30);

    await runUntil(t, async () => (await assignmentOf(req.id))!.status === 'ARRIVED', 900);
    const arrived = (await assignmentOf(req.id))!;
    const driveSec = (arrived.arrivedAt!.getTime() - arrived.enRouteAt!.getTime()) / 1000;
    expect(Math.abs(driveSec - pathLengthMeters(path) / (40 / 3.6))).toBeLessThan(4);
    await expectLedgerBalanced(t);
  });

  it('only acts for bots: human handymen keep their offers and jobs', async () => {
    const human = await createSoloHandyman(t, { trades: ['plumbing'], balance: 5000, online: true });
    await t.app.get(PresenceService).setOnline(human.handymanId, BAKU.center);
    const customer = await createCustomer(t, { balance: 5000 });
    const req = await request(customer.token, BAKU.center);
    const offer = await t.prisma.offer.findFirstOrThrow({ where: { requestId: req.id, handymanId: human.handymanId } });
    await runSeconds(t, 10);
    expect((await t.prisma.offer.findUniqueOrThrow({ where: { id: offer.id } })).status).not.toBe('ACCEPTED');
    expect(await assignmentOf(req.id)).toBeNull();

    // A human's own job is never driven either.
    const req2 = await request(customer.token, BAKU.center);
    await t.app.get(PresenceService).setOnline(human.handymanId, BAKU.center);
    const offer2 = await t.prisma.offer.findFirst({ where: { requestId: req2.id, handymanId: human.handymanId, status: 'SENT' } });
    expect(offer2).not.toBeNull();
    await t.client(human.token, 'az').call(api.pro.acceptOffer, { params: { id: offer2!.id } });
    await runSeconds(t, 20);
    expect((await assignmentOf(req2.id))!.status).toBe('ACCEPTED');
    await expectLedgerBalanced(t);
  });

  it('with autoAccept off bots let offers expire; with autoArrive / autoPrice off they stop at the door', async () => {
    const { bot, adminToken: token } = await spawnBot();
    await t.client(token).call(api.admin.demoConfig, { body: { autoAccept: false } });
    const customer = await createCustomer(t, { balance: 5000 });
    const req = await request(customer.token, BAKU.center);
    const offer = await t.prisma.offer.findFirstOrThrow({ where: { requestId: req.id, handymanId: bot.id } });
    await runSeconds(t, 20);
    expect((await t.prisma.offer.findUniqueOrThrow({ where: { id: offer.id } })).status).toBe('EXPIRED');
    expect(await assignmentOf(req.id)).toBeNull();
    await t.client(customer.token).call(api.requests.cancel, { params: { id: req.id }, body: {} });

    await t.client(token).call(api.admin.demoConfig, { body: { autoAccept: true, autoArrive: false, speedKmh: 120 } });
    const req2 = await request(customer.token, BAKU.narimanov);
    await runUntil(t, async () => (await assignmentOf(req2.id))?.status === 'EN_ROUTE', 200);
    await runSeconds(t, 150); // far longer than the drive at 120 km/h
    const waiting = (await assignmentOf(req2.id))!;
    expect(waiting.status).toBe('EN_ROUTE');
    expect(haversineMeters({ lat: waiting.lastLat!, lng: waiting.lastLng! }, BAKU.narimanov)).toBeLessThan(10);
    // Still online and fresh while waiting at the door.
    const live = await t.app.get(PresenceService).get(bot.id);
    expect(live?.online).toBe(true);
    expect(t.clock.nowMs() - live!.ts).toBeLessThanOrEqual(15_000);

    await t.client(token).call(api.admin.demoConfig, { body: { autoArrive: true, autoPrice: false } });
    await runUntil(t, async () => (await assignmentOf(req2.id))!.status === 'ARRIVED', 10);
    await runSeconds(t, 20);
    expect((await assignmentOf(req2.id))!.status).toBe('ARRIVED');
    await t.client(token).call(api.admin.demoConfig, { body: { autoPrice: true, priceLabor: 2000, priceMaterials: 0 } });
    await runUntil(t, async () => (await assignmentOf(req2.id))!.status === 'PRICE_PROPOSED', 10);
    expect(Number((await assignmentOf(req2.id))!.totalAmount)).toBe(2000);
    await expectLedgerBalanced(t);
  });

  it('keeps idle bots online (presence heartbeat) and back online after the snapshot sweep', async () => {
    const { bot } = await spawnBot();
    const presence = t.app.get(PresenceService);
    await runSeconds(t, 40);
    let live = await presence.get(bot.id);
    expect(live?.online).toBe(true);
    expect(t.clock.nowMs() - live!.ts).toBeLessThanOrEqual(15_000);
    // The DB flag was switched off (e.g. the offline sweep after a long outage): the next tick puts the bot online again.
    await t.prisma.handymanProfile.update({ where: { id: bot.id }, data: { isOnline: false } });
    await presence.setOffline(bot.id);
    await runSeconds(t, 2);
    expect((await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: bot.id } })).isOnline).toBe(true);
    live = await presence.get(bot.id);
    expect(live?.online).toBe(true);
  });

  it('a scheduled job: the bot accepts the pre-offer and leaves 30 minutes before scheduledAt', async () => {
    const { bot } = await spawnBot();
    const customer = await createCustomer(t, { balance: 5000 });
    const scheduledAt = new Date(t.clock.nowMs() + 90 * 60_000);
    const req = await request(customer.token, BAKU.center, { timing: 'SCHEDULED', scheduledAt: scheduledAt.toISOString() });
    await runUntil(t, async () => !!(await assignmentOf(req.id)), 30);
    await runSeconds(t, 60);
    expect((await assignmentOf(req.id))!.status).toBe('ACCEPTED');
    // ~31 minutes before scheduledAt: not yet.
    t.clock.advance(58 * 60_000);
    await t.jobs.runDue();
    await runSeconds(t, 5);
    expect((await assignmentOf(req.id))!.status).toBe('ACCEPTED');
    await runUntil(t, async () => (await assignmentOf(req.id))!.status === 'EN_ROUTE', 120);
    const a = (await assignmentOf(req.id))!;
    expect(a.handymanId).toBe(bot.id);
    expect(scheduledAt.getTime() - a.enRouteAt!.getTime()).toBeLessThanOrEqual(30 * 60_000);
    await expectLedgerBalanced(t);
  });

  it('company bots: company offers stay with the manager; the manager prices when the company says so', async () => {
    const company = await createCompany(t, { trades: ['plumbing'], workers: 0, balance: 5000, finalPriceEntry: 'MANAGER' });
    const { bot } = await spawnBot({ companyId: company.companyId });
    const customer = await createCustomer(t, { balance: 5000 });
    const req = await request(customer.token, BAKU.center);
    const offer = await t.prisma.offer.findFirstOrThrow({ where: { requestId: req.id, companyId: company.companyId } });
    await runSeconds(t, 8);
    expect((await t.prisma.offer.findUniqueOrThrow({ where: { id: offer.id } })).status).toBe('SENT');
    await t.app.get(OffersService).acceptCompany(company.manager.userId, company.companyId, offer.id, [bot.id], 'az');
    await runUntil(t, async () => (await assignmentOf(req.id))!.status === 'ARRIVED', 300);
    await runSeconds(t, 20);
    expect((await assignmentOf(req.id))!.status).toBe('ARRIVED');
    await expectLedgerBalanced(t);
  });

  it('botPosition is a pure function of the path, the speed and the elapsed time', () => {
    const path = [BAKU.center, BAKU.narimanov];
    const total = pathLengthMeters(path);
    expect(botPosition(path, 36, 0).at).toEqual(BAKU.center);
    const half = botPosition(path, 36, (total / 2 / 10) * 1000);
    expect(half.done).toBe(false);
    expect(Math.abs(haversineMeters(BAKU.center, half.at) - total / 2)).toBeLessThan(2);
    expect(botPosition(path, 36, (total / 10) * 1000 + 1).done).toBe(true);
    expect(botPosition(path, 36, (total / 10) * 1000 + 1).at).toEqual(BAKU.narimanov);
  });
});
