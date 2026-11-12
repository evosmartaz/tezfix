import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { latLngToCell } from 'h3-js';
import { rooms } from '@tezfiks/shared';
import { createTestApp, type TestApp } from '../helpers/app';
import { BAKU, createCompany, createCustomer, createSoloHandyman } from '../helpers/factories';
import { PresenceService, type LocationEvent } from '../../src/modules/realtime/presence.service';
import { createAssignment, createRequest } from './helpers';

const cell7 = (p: { lat: number; lng: number }) => latLngToCell(p.lat, p.lng, 7);

/**
 * Review Focus #1/#3: concurrent presence updates. Each test starts the competing operations in the same tick, so their
 * Redis commands interleave exactly as they would with a location ping in flight (a read-modify-write implementation
 * loses the setBusy/setOffline here deterministically).
 */
describe('PresenceService concurrency', () => {
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

  it('setBusy(true) racing a location ping is never lost (accept while a ping is in flight)', async () => {
    const pro = await createSoloHandyman(t, { online: true });
    await presence.setOnline(pro.handymanId, BAKU.center);
    await Promise.all([presence.updateLocation(pro.handymanId, BAKU.narimanov), presence.setBusy(pro.handymanId, true)]);
    const s = await presence.get(pro.handymanId);
    expect(s).toMatchObject({ busy: true, online: true, lat: BAKU.narimanov.lat, cell7: cell7(BAKU.narimanov) });
    expect((await presence.candidatesInCells([cell7(BAKU.narimanov)], 90))[0]).toMatchObject({ handymanId: pro.handymanId, busy: true });

    // Job ends while pings keep coming: the last setBusy wins.
    await Promise.all([
      presence.updateLocation(pro.handymanId, BAKU.center),
      presence.setBusy(pro.handymanId, false),
      presence.updateLocation(pro.handymanId, BAKU.narimanov),
    ]);
    expect((await presence.get(pro.handymanId))?.busy).toBe(false);
  });

  it('many interleaved pings and busy flips end in the last busy state', async () => {
    const pro = await createSoloHandyman(t, { online: true });
    await presence.setOnline(pro.handymanId, BAKU.center);
    const ops: Promise<unknown>[] = [];
    for (let i = 0; i < 10; i++) {
      ops.push(presence.updateLocation(pro.handymanId, i % 2 ? BAKU.center : BAKU.narimanov));
      ops.push(presence.setBusy(pro.handymanId, i % 2 === 0));
      ops.push(presence.touch(pro.handymanId));
    }
    await Promise.all(ops);
    // i = 9 -> setBusy(false) was the last flip.
    expect((await presence.get(pro.handymanId))?.busy).toBe(false);
    await Promise.all([presence.touch(pro.handymanId), presence.setBusy(pro.handymanId, true), presence.touch(pro.handymanId)]);
    expect((await presence.get(pro.handymanId))?.busy).toBe(true);
  });

  it('setOffline racing a location ping never resurrects the handyman as a candidate (either order)', async () => {
    for (const order of ['offline-first', 'ping-first'] as const) {
      const pro = await createSoloHandyman(t, { online: true });
      await presence.setOnline(pro.handymanId, BAKU.center);
      // B2 flips the DB first, then calls setOffline; a ping is in flight at the same time.
      await t.prisma.handymanProfile.update({ where: { id: pro.handymanId }, data: { isOnline: false } });
      if (order === 'offline-first') await Promise.all([presence.setOffline(pro.handymanId), presence.updateLocation(pro.handymanId, BAKU.center)]);
      else await Promise.all([presence.updateLocation(pro.handymanId, BAKU.center), presence.setOffline(pro.handymanId)]);
      const cands = await presence.candidatesInCells([cell7(BAKU.center)], 90);
      expect(cands.map((c) => c.handymanId)).not.toContain(pro.handymanId);
      expect(await t.redis.client.zscore(t.redis.key('pres', 'all'), pro.handymanId)).toBeNull();
      expect(await t.redis.client.zscore(t.redis.key('pres', '7', cell7(BAKU.center)), pro.handymanId)).toBeNull();
      const s = await presence.get(pro.handymanId);
      if (s) expect(s.online).toBe(false); // a later ping may keep a tracking entry, never an online one
    }
  });

  it('a heartbeat racing setOffline leaves no online or partial entry', async () => {
    const pro = await createSoloHandyman(t, { online: true });
    await presence.setOnline(pro.handymanId, BAKU.center);
    await t.prisma.handymanProfile.update({ where: { id: pro.handymanId }, data: { isOnline: false } });
    await Promise.all([presence.touch(pro.handymanId), presence.setOffline(pro.handymanId), presence.touch(pro.handymanId)]);
    expect(await presence.candidatesInCells([cell7(BAKU.center)], 90)).toEqual([]);
    const raw = await t.redis.client.hgetall(t.redis.key('hm', pro.handymanId));
    // Either gone entirely or a complete offline entry; never a hash without identity.
    if (Object.keys(raw).length) expect(raw).toMatchObject({ userId: pro.userId, online: '0' });
  });

  it('an expired entry rebuilt from a stale DB read (taken before B2 went offline) stays offline', async () => {
    const pro = await createSoloHandyman(t, { online: true });
    const anyP = presence as unknown as { metaFromDb: (id: string) => Promise<unknown> };
    const orig = anyP.metaFromDb.bind(presence);
    let once = true;
    anyP.metaFromDb = async (id: string) => {
      const meta = await orig(id); // still says online
      if (once) {
        once = false;
        await t.prisma.handymanProfile.update({ where: { id }, data: { isOnline: false } });
        await presence.setOffline(id);
      }
      return meta;
    };
    try {
      const e = await presence.updateLocation(pro.handymanId, BAKU.center);
      expect(e?.online).toBe(false);
    } finally {
      anyP.metaFromDb = orig;
    }
    expect(await presence.candidatesInCells([cell7(BAKU.center)], 90)).toEqual([]);
    expect(await presence.touch(pro.handymanId)).toBe(true); // tracking entry exists
    expect(await presence.candidatesInCells([cell7(BAKU.center)], 90)).toEqual([]);

    // Going online again (B2: DB flags, then setOnline) clears the offline marker.
    await t.prisma.handymanProfile.update({ where: { id: pro.handymanId }, data: { isOnline: true, onlineSince: t.clock.now() } });
    await presence.setOnline(pro.handymanId, BAKU.center);
    expect((await presence.candidatesInCells([cell7(BAKU.center)], 90)).map((c) => c.handymanId)).toEqual([pro.handymanId]);
    await presence.updateLocation(pro.handymanId, BAKU.center);
    expect((await presence.get(pro.handymanId))?.online).toBe(true);
  });

  it('setOnline racing setBusy(true) on a live entry keeps busy', async () => {
    const pro = await createSoloHandyman(t, { online: true });
    await presence.setOnline(pro.handymanId, BAKU.center);
    await Promise.all([presence.setOnline(pro.handymanId, BAKU.narimanov), presence.setBusy(pro.handymanId, true)]);
    expect(await presence.get(pro.handymanId)).toMatchObject({ busy: true, online: true, lat: BAKU.narimanov.lat });
  });

  it('pings never flip busy or online; only setBusy / setOnline / setOffline do', async () => {
    const pro = await createSoloHandyman(t, { online: true });
    await presence.setOnline(pro.handymanId, BAKU.center);
    await presence.setBusy(pro.handymanId, true);
    for (let i = 0; i < 3; i++) await presence.updateLocation(pro.handymanId, BAKU.narimanov);
    expect(await presence.get(pro.handymanId)).toMatchObject({ busy: true, online: true });
  });
});

describe('location events carry a verified assignment id', () => {
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

  it('verifiedAssignmentId is set only for an assignment of this handyman', async () => {
    const customer = await createCustomer(t);
    const pro = await createSoloHandyman(t, { online: true });
    const other = await createSoloHandyman(t, { online: true });
    const r1 = await createRequest(t, customer);
    const r2 = await createRequest(t, customer);
    const own = await createAssignment(t, { requestId: r1.requestId, slotId: r1.slotId, handymanId: pro.handymanId, userId: pro.userId, status: 'EN_ROUTE' });
    const foreign = await createAssignment(t, { requestId: r2.requestId, slotId: r2.slotId, handymanId: other.handymanId, userId: other.userId, status: 'EN_ROUTE' });
    await presence.setOnline(pro.handymanId, BAKU.center);
    const seen: LocationEvent[] = [];
    const off = presence.onLocation(async (e) => {
      seen.push(e);
    });
    try {
      await presence.updateLocation(pro.handymanId, { ...BAKU.center, assignmentId: own });
      await presence.updateLocation(pro.handymanId, { ...BAKU.center, assignmentId: foreign });
      await presence.updateLocation(pro.handymanId, { ...BAKU.center, assignmentId: crypto.randomUUID() });
      await presence.updateLocation(pro.handymanId, BAKU.center);
    } finally {
      off();
    }
    expect(seen.map((e) => e.verifiedAssignmentId)).toEqual([own, null, null, null]);
    expect(seen[1]!.assignmentId).toBe(foreign);
  });
});

describe('presence snapshot races and DB reconciliation', () => {
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

  it('a snapshot tick between B2 flipping the DB online and presence.setOnline does not turn the pro offline', async () => {
    const pro = await createSoloHandyman(t, { online: false });
    const yesterday = new Date(t.clock.nowMs() - 24 * 3_600_000);
    await t.prisma.handymanProfile.update({ where: { id: pro.handymanId }, data: { lastSeenAt: yesterday } });

    // B2 step 1: DB flags (onlineSince = now). The reconciler fires before step 2.
    await t.prisma.handymanProfile.update({ where: { id: pro.handymanId }, data: { isOnline: true, onlineSince: t.clock.now() } });
    expect((await presence.snapshot()).wentOffline).toBe(0);
    await presence.snapshot({ force: false });
    expect((await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: pro.handymanId } })).isOnline).toBe(true);

    // B2 step 2.
    await presence.setOnline(pro.handymanId, BAKU.center);
    await t.reconciler.tickAll();
    expect((await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: pro.handymanId } })).isOnline).toBe(true);
    expect((await presence.candidatesInCells([cell7(BAKU.center)], 90)).map((c) => c.handymanId)).toEqual([pro.handymanId]);
  });

  it('a fresh presence entry protects a pro whose DB lastSeenAt is old even before the snapshot write', async () => {
    const pro = await createSoloHandyman(t, { online: false });
    const old = new Date(t.clock.nowMs() - 24 * 3_600_000);
    // Flags flipped without onlineSince (defensive: a caller that forgets it).
    await t.prisma.handymanProfile.update({ where: { id: pro.handymanId }, data: { isOnline: true, onlineSince: null, lastSeenAt: old } });
    await presence.setOnline(pro.handymanId, BAKU.center);
    // Throttle the DB write so only the Redis freshness protects the pro.
    await t.redis.client.set(t.redis.key('pres', 'snapAt'), String(t.clock.nowMs()));
    const res = await presence.snapshot({ force: false });
    expect(res).toEqual({ written: 0, wentOffline: 0 });
    expect((await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: pro.handymanId } })).isOnline).toBe(true);
    expect(await presence.get(pro.handymanId)).toMatchObject({ online: true });
  });

  it('only rows the stale update actually changed are removed from presence and announced', async () => {
    const co = await createCompany(t, { workers: 2, workersOnline: true });
    const [stale, fresh] = co.workers;
    await presence.setOnline(stale!.handymanId, BAKU.center);
    t.clock.advance(31 * 60_000);
    await presence.setOnline(fresh!.handymanId, BAKU.center); // online just now
    t.realtime.clearSent();
    const res = await presence.snapshot();
    expect(res.wentOffline).toBe(1);
    expect((await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: stale!.handymanId } })).isOnline).toBe(false);
    expect((await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: fresh!.handymanId } })).isOnline).toBe(true);
    expect(await presence.get(stale!.handymanId)).toBeNull();
    expect(await presence.get(fresh!.handymanId)).toMatchObject({ online: true });
    expect(t.realtime.sentTo(rooms.company(co.companyId), 'company:workers')).toHaveLength(1);

    // Nothing left to flip: no announcement, no removal.
    t.realtime.clearSent();
    expect((await presence.snapshot()).wentOffline).toBe(0);
    expect(t.realtime.sentTo(rooms.company(co.companyId), 'company:workers')).toHaveLength(0);
    expect(await presence.get(fresh!.handymanId)).toMatchObject({ online: true });
  });

  it('an online Redis entry whose DB flag is off is demoted (no longer a candidate, tracking kept)', async () => {
    const pro = await createSoloHandyman(t, { online: true });
    await presence.setOnline(pro.handymanId, BAKU.center);
    // E.g. account deletion or an admin block flipped the DB without calling setOffline.
    await t.prisma.handymanProfile.update({ where: { id: pro.handymanId }, data: { isOnline: false } });
    await presence.snapshot({ force: false });
    expect(await presence.candidatesInCells([cell7(BAKU.center)], 90)).toEqual([]);
    expect(await presence.get(pro.handymanId)).toMatchObject({ online: false, lat: BAKU.center.lat });
    // Further pings keep it offline.
    await presence.updateLocation(pro.handymanId, BAKU.center);
    expect(await presence.candidatesInCells([cell7(BAKU.center)], 90)).toEqual([]);
  });

  it('the reconciler writes the DB snapshot at most every 60 s of Clock time; a direct snapshot() always writes', async () => {
    const pro = await createSoloHandyman(t, { online: true });
    await presence.setOnline(pro.handymanId, BAKU.center);
    await t.reconciler.tickAll();
    const p0 = await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: pro.handymanId } });
    expect(p0.lastCell7).toBe(cell7(BAKU.center));

    t.clock.advance(30_000);
    await presence.updateLocation(pro.handymanId, BAKU.narimanov);
    await t.reconciler.tickAll();
    expect((await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: pro.handymanId } })).lastCell7).toBe(cell7(BAKU.center));

    t.clock.advance(31_000);
    await t.reconciler.tickAll();
    const p2 = await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: pro.handymanId } });
    expect(p2).toMatchObject({ lastCell7: cell7(BAKU.narimanov), lastLat: BAKU.narimanov.lat, lastLng: BAKU.narimanov.lng });

    await presence.updateLocation(pro.handymanId, BAKU.ahmadli);
    const res = await presence.snapshot();
    expect(res.written).toBe(1);
    expect((await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: pro.handymanId } })).lastCell7).toBe(cell7(BAKU.ahmadli));
  });

  it('the bulk snapshot writes many handymen in one pass', async () => {
    const pros: Array<{ handymanId: string }> = [];
    for (let i = 0; i < 5; i++) pros.push(await createSoloHandyman(t, { online: true }));
    const spots = [BAKU.center, BAKU.narimanov, BAKU.ahmadli, BAKU.center, BAKU.narimanov];
    for (let i = 0; i < pros.length; i++) await presence.setOnline(pros[i]!.handymanId, spots[i]);
    t.clock.advance(1_000);
    for (let i = 0; i < pros.length; i++) await presence.touch(pros[i]!.handymanId);
    const res = await presence.snapshot();
    expect(res.written).toBe(5);
    for (let i = 0; i < pros.length; i++) {
      const p = await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: pros[i]!.handymanId } });
      expect(p).toMatchObject({ lastLat: spots[i]!.lat, lastLng: spots[i]!.lng, lastCell7: cell7(spots[i]!) });
      expect(p.lastSeenAt?.getTime()).toBe((await presence.get(pros[i]!.handymanId))!.ts);
    }
  });
});
