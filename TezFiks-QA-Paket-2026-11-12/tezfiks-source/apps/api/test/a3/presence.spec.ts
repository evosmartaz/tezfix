import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { latLngToCell } from 'h3-js';
import { rooms } from '@tezfiks/shared';
import { createTestApp, type TestApp } from '../helpers/app';
import { BAKU, createCompany, createCustomer, createSoloHandyman } from '../helpers/factories';
import { PresenceService, type LocationEvent } from '../../src/modules/realtime/presence.service';
import { createAssignment, createRequest } from './helpers';

const cell7 = (p: { lat: number; lng: number }) => latLngToCell(p.lat, p.lng, 7);

describe('PresenceService', () => {
  let t: TestApp;
  let presence: PresenceService;
  beforeAll(async () => {
    t = await createTestApp();
    presence = t.app.get(PresenceService);
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
  });

  it('setOnline indexes the handyman in the res-7 cell ZSET and the hm:<id> hash with a 120 s TTL', async () => {
    const pro = await createSoloHandyman(t, { online: true });
    const before = t.clock.nowMs();
    const state = await presence.setOnline(pro.handymanId, BAKU.narimanov);
    const after = t.clock.nowMs();
    expect(state!.ts).toBeGreaterThanOrEqual(before);
    expect(state!.ts).toBeLessThanOrEqual(after);
    expect(state).toMatchObject({
      handymanId: pro.handymanId,
      userId: pro.userId,
      companyId: null,
      lat: BAKU.narimanov.lat,
      lng: BAKU.narimanov.lng,
      cell7: cell7(BAKU.narimanov),
      cell9: latLngToCell(BAKU.narimanov.lat, BAKU.narimanov.lng, 9),
      busy: false,
      online: true,
    });
    const zkey = t.redis.key('pres', '7', cell7(BAKU.narimanov));
    expect(await t.redis.client.zscore(zkey, pro.handymanId)).toBe(String(state!.ts));
    const ttl = await t.redis.client.ttl(t.redis.key('hm', pro.handymanId));
    expect(ttl).toBeGreaterThan(100);
    expect(ttl).toBeLessThanOrEqual(120);
  });

  it('setOnline without a location falls back to the DB last location', async () => {
    const pro = await createSoloHandyman(t, { base: BAKU.ahmadli, online: true });
    const state = await presence.setOnline(pro.handymanId);
    expect(state).toMatchObject({ lat: BAKU.ahmadli.lat, lng: BAKU.ahmadli.lng, cell7: cell7(BAKU.ahmadli) });
    expect(await presence.setOnline(crypto.randomUUID())).toBeNull();
  });

  it('candidatesInCells returns fresh online handymen of the given cells only', async () => {
    const a = await createSoloHandyman(t, { online: true });
    const b = await createSoloHandyman(t, { online: true });
    const far = await createSoloHandyman(t, { online: true });
    await presence.setOnline(a.handymanId, BAKU.center);
    await presence.setOnline(b.handymanId, BAKU.center);
    await presence.setOnline(far.handymanId, BAKU.ahmadli);
    const got = await presence.candidatesInCells([cell7(BAKU.center)], 90);
    expect(got.map((c) => c.handymanId).sort()).toEqual([a.handymanId, b.handymanId].sort());
    expect(got[0]).toEqual({
      handymanId: expect.any(String),
      userId: expect.any(String),
      companyId: null,
      lat: BAKU.center.lat,
      lng: BAKU.center.lng,
      busy: false,
      ts: expect.any(Number),
    });
    const both = await presence.candidatesInCells([cell7(BAKU.center), cell7(BAKU.ahmadli), cell7(BAKU.center)], 90);
    expect(both).toHaveLength(3);
    expect(await presence.candidatesInCells([], 90)).toEqual([]);
  });

  it('skips stale entries (Clock based) and a ping makes them fresh again', async () => {
    const pro = await createSoloHandyman(t, { online: true });
    await presence.setOnline(pro.handymanId, BAKU.center);
    t.clock.advance(89_000);
    expect(await presence.candidatesInCells([cell7(BAKU.center)], 90)).toHaveLength(1); // just inside the window
    t.clock.advance(1_500);
    expect(await presence.candidatesInCells([cell7(BAKU.center)], 90)).toHaveLength(0);
    await presence.updateLocation(pro.handymanId, BAKU.center);
    expect(await presence.candidatesInCells([cell7(BAKU.center)], 90)).toHaveLength(1);
  });

  it('moving to another cell removes the handyman from the old cell', async () => {
    const pro = await createSoloHandyman(t, { online: true });
    await presence.setOnline(pro.handymanId, BAKU.center);
    await presence.updateLocation(pro.handymanId, BAKU.ahmadli);
    expect(await presence.candidatesInCells([cell7(BAKU.center)], 90)).toEqual([]);
    expect((await presence.candidatesInCells([cell7(BAKU.ahmadli)], 90)).map((c) => c.handymanId)).toEqual([pro.handymanId]);
    expect(await t.redis.client.zscore(t.redis.key('pres', '7', cell7(BAKU.center)), pro.handymanId)).toBeNull();
  });

  it('setBusy flips the busy flag and never creates a partial entry', async () => {
    const pro = await createSoloHandyman(t, { online: true });
    await presence.setOnline(pro.handymanId, BAKU.center);
    await presence.setBusy(pro.handymanId, true);
    expect((await presence.get(pro.handymanId))?.busy).toBe(true);
    expect((await presence.candidatesInCells([cell7(BAKU.center)], 90))[0]?.busy).toBe(true);
    await presence.setBusy(pro.handymanId, false);
    expect((await presence.get(pro.handymanId))?.busy).toBe(false);

    const ghost = crypto.randomUUID();
    await presence.setBusy(ghost, true);
    expect(await presence.get(ghost)).toBeNull();
    expect(await t.redis.client.exists(t.redis.key('hm', ghost))).toBe(0);
  });

  it('setOffline removes the handyman from cells and drops the hash', async () => {
    const pro = await createSoloHandyman(t, { online: true });
    await presence.setOnline(pro.handymanId, BAKU.center);
    await presence.setOffline(pro.handymanId);
    expect(await presence.get(pro.handymanId)).toBeNull();
    expect(await presence.candidatesInCells([cell7(BAKU.center)], 90)).toEqual([]);
  });

  it('location pings of an offline handyman are stored for tracking but never make them a candidate', async () => {
    const pro = await createSoloHandyman(t, { online: false });
    const e = await presence.updateLocation(pro.handymanId, BAKU.center);
    expect(e).toMatchObject({ online: false, handymanId: pro.handymanId });
    expect(await presence.get(pro.handymanId)).toMatchObject({ online: false, lat: BAKU.center.lat });
    expect(await presence.candidatesInCells([cell7(BAKU.center)], 90)).toEqual([]);
    expect(await presence.updateLocation(crypto.randomUUID(), BAKU.center)).toBeNull();
    expect(await presence.updateLocation(pro.handymanId, { lat: Number.NaN, lng: 1 })).toBeNull();
  });

  it('an expired entry is rebuilt from the DB, including busy from an active assignment', async () => {
    const customer = await createCustomer(t);
    const pro = await createSoloHandyman(t, { online: true });
    const { requestId, slotId } = await createRequest(t, customer);
    await createAssignment(t, { requestId, slotId, handymanId: pro.handymanId, userId: pro.userId, status: 'EN_ROUTE' });
    await t.redis.client.del(t.redis.key('hm', pro.handymanId)); // simulate TTL expiry
    await presence.updateLocation(pro.handymanId, BAKU.narimanov);
    expect(await presence.get(pro.handymanId)).toMatchObject({ busy: true, online: true, userId: pro.userId });
    expect((await presence.candidatesInCells([cell7(BAKU.narimanov)], 90))[0]).toMatchObject({ handymanId: pro.handymanId, busy: true });
  });

  it('touch refreshes a live entry and recreates an expired one only for handymen online in the DB', async () => {
    const on = await createSoloHandyman(t, { online: true });
    const off = await createSoloHandyman(t, { online: false });
    expect(await presence.touch(on.handymanId)).toBe(true);
    expect(await presence.get(on.handymanId)).toMatchObject({ online: true, lat: BAKU.center.lat });
    expect(await presence.touch(off.handymanId)).toBe(false);
    expect(await presence.get(off.handymanId)).toBeNull();
    t.clock.advance(30_000);
    const before = t.clock.nowMs();
    expect(await presence.touch(on.handymanId)).toBe(true);
    const ts = (await presence.get(on.handymanId))!.ts;
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(t.clock.nowMs());
  });

  it('onLocation handlers receive every update; a failing handler does not break others; unsubscribe works', async () => {
    const pro = await createSoloHandyman(t, { online: true });
    await presence.setOnline(pro.handymanId, BAKU.center);
    const seen: LocationEvent[] = [];
    const offBad = presence.onLocation(async () => {
      throw new Error('boom');
    });
    const off = presence.onLocation(async (e) => {
      seen.push(e);
    });
    try {
      const clientAt = new Date(t.clock.nowMs() - 2000).toISOString();
      const before = t.clock.nowMs();
      await presence.updateLocation(pro.handymanId, { ...BAKU.narimanov, heading: 45, at: clientAt });
      expect(seen).toHaveLength(1);
      expect(seen[0]!.at.toISOString()).toBe(clientAt);
      expect(seen[0]!.receivedAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(seen[0]!.receivedAt.getTime()).toBeLessThanOrEqual(t.clock.nowMs());
      // A client clock far in the future is ignored.
      await presence.updateLocation(pro.handymanId, { ...BAKU.narimanov, at: new Date(t.clock.nowMs() + 3_600_000).toISOString() });
      expect(seen[1]!.at.getTime()).toBe(seen[1]!.receivedAt.getTime());
    } finally {
      off();
      offBad();
    }
    await presence.updateLocation(pro.handymanId, BAKU.center);
    expect(seen).toHaveLength(2);
  });

  it('snapshot writes presence to HandymanProfile and turns handymen unseen for 30 min offline', async () => {
    const pro = await createSoloHandyman(t, { online: true, base: BAKU.center });
    const co = await createCompany(t, { workers: 1, workersOnline: true });
    const w = co.workers[0]!;
    await presence.setOnline(pro.handymanId, BAKU.narimanov);
    await presence.updateLocation(w.handymanId, BAKU.ahmadli);
    const seenAt = (await presence.get(pro.handymanId))!.ts;

    await t.reconciler.tickAll();
    const p1 = await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: pro.handymanId } });
    expect(p1).toMatchObject({ lastLat: BAKU.narimanov.lat, lastLng: BAKU.narimanov.lng, lastCell7: cell7(BAKU.narimanov), isOnline: true });
    expect(p1.lastSeenAt?.getTime()).toBe(seenAt);
    const w1 = await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: w.handymanId } });
    expect(w1).toMatchObject({ lastLat: BAKU.ahmadli.lat, lastCell7: cell7(BAKU.ahmadli), isOnline: true });

    // 29 minutes later the pro pings again; the worker stays silent.
    t.clock.advance(29 * 60_000);
    await presence.updateLocation(pro.handymanId, BAKU.center);
    t.clock.advance(2 * 60_000);
    t.realtime.clearSent();
    const res = await presence.snapshot();
    expect(res.wentOffline).toBe(1);
    expect((await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: pro.handymanId } })).isOnline).toBe(true);
    expect((await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: pro.handymanId } })).lastLat).toBe(BAKU.center.lat);
    expect((await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: w.handymanId } })).isOnline).toBe(false);
    expect(await presence.get(w.handymanId)).toBeNull();
    expect(t.realtime.sentTo(rooms.company(co.companyId), 'company:workers')).toEqual([
      { room: rooms.company(co.companyId), event: 'company:workers', payload: { companyId: co.companyId } },
    ]);
  });

  it('snapshot flips DB-online handymen with no presence and an old lastSeenAt', async () => {
    const pro = await createSoloHandyman(t, { online: true });
    t.clock.advance(31 * 60_000);
    await presence.snapshot();
    expect((await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: pro.handymanId } })).isOnline).toBe(false);
  });

  it('snapshot never moves lastSeenAt backwards and drops index members whose hash expired', async () => {
    const pro = await createSoloHandyman(t, { online: true });
    await presence.setOnline(pro.handymanId, BAKU.center);
    const later = new Date(t.clock.nowMs() + 60_000);
    await t.prisma.handymanProfile.update({ where: { id: pro.handymanId }, data: { lastSeenAt: later, lastLat: 1 } });
    await presence.snapshot();
    const p = await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: pro.handymanId } });
    expect(p.lastSeenAt?.getTime()).toBe(later.getTime());
    expect(p.lastLat).toBe(1);

    await t.redis.client.del(t.redis.key('hm', pro.handymanId));
    await presence.snapshot();
    expect(await t.redis.client.zscore(t.redis.key('pres', 'all'), pro.handymanId)).toBeNull();
  });
});
