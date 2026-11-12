import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { latLngToCell } from 'h3-js';
import { api, rooms, type LatLng } from '@tezfiks/shared';
import { createTestApp, type TestApp } from '../helpers/app';
import { BAKU } from '../helpers/factories';
import type { LocationEvent } from '../../src/modules/realtime/presence.service';
import { along, assignmentRow, setSettings, soloJob, tracking } from './helpers';

function event(job: { h: { handymanId: string; userId: string } }, assignmentId: string, loc: LatLng, at: Date, receivedAt: Date): LocationEvent {
  return {
    handymanId: job.h.handymanId,
    userId: job.h.userId,
    companyId: null,
    lat: loc.lat,
    lng: loc.lng,
    heading: null,
    speed: null,
    accuracy: null,
    at,
    receivedAt,
    assignmentId,
    verifiedAssignmentId: assignmentId,
    cell7: latLngToCell(loc.lat, loc.lng, 7),
    cell9: latLngToCell(loc.lat, loc.lng, 9),
    online: true,
  };
}

/**
 * Hardening of the location ping path: pings arriving faster than every 2 s per handyman are not processed (each one costs
 * DB reads, a possible re-route and socket fan-out), and the position write itself is conditional, so an older ping that
 * read the row before a newer one was written can never overwrite it.
 */
describe('B3 location ping guards', () => {
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

  it('pings less than 2 s after the last processed one are ignored; the next one after 2 s is processed', async () => {
    const job = await soloJob(t);
    const { c, h, assignmentId: id } = job;
    const H = t.client(h.token);
    const p1 = along(BAKU.ahmadli, BAKU.center, 0.2);
    const p2 = along(BAKU.ahmadli, BAKU.center, 0.3);
    t.realtime.clearSent();
    t.clock.advance(5_000);
    await H.call(api.pro.location, { body: { lat: p1.lat, lng: p1.lng } });
    expect((await assignmentRow(t, id)).lastLat).toBe(p1.lat);
    t.clock.advance(1_000);
    await H.call(api.pro.location, { body: { lat: p2.lat, lng: p2.lng } });
    expect((await assignmentRow(t, id)).lastLat).toBe(p1.lat);
    expect(t.realtime.sentTo(rooms.user(c.userId), 'assignment:location')).toHaveLength(1);
    // (The test Clock keeps running in real time between calls, so the steps leave a margin around the 2 s boundary.)
    t.clock.advance(500);
    await H.call(api.pro.location, { body: { lat: p2.lat, lng: p2.lng } });
    expect((await assignmentRow(t, id)).lastLat).toBe(p1.lat); // ~1.5 s after the processed one
    t.clock.advance(600);
    await H.call(api.pro.location, { body: { lat: p2.lat, lng: p2.lng } });
    expect((await assignmentRow(t, id)).lastLat).toBe(p2.lat);
    expect(t.realtime.sentTo(rooms.user(c.userId), 'assignment:location')).toHaveLength(2);
  });

  it('the throttle is per handyman: another pro is not slowed down', async () => {
    const a = await soloJob(t);
    const b = await soloJob(t);
    t.clock.advance(5_000);
    const p = along(BAKU.ahmadli, BAKU.center, 0.2);
    await t.client(a.h.token).call(api.pro.location, { body: { lat: p.lat, lng: p.lng } });
    await t.client(b.h.token).call(api.pro.location, { body: { lat: p.lat, lng: p.lng } });
    expect((await assignmentRow(t, a.assignmentId)).lastLat).toBe(p.lat);
    expect((await assignmentRow(t, b.assignmentId)).lastLat).toBe(p.lat);
  });

  it('an older ping that read the row before a newer ping was written does not overwrite it (conditional write)', async () => {
    const job = await soloJob(t);
    const { c, h, assignmentId: id } = job;
    const H = t.client(h.token);
    const p1 = along(BAKU.ahmadli, BAKU.center, 0.2);
    const p2 = along(BAKU.ahmadli, BAKU.center, 0.4);
    t.clock.advance(5_000);
    await H.call(api.pro.location, { body: { lat: p1.lat, lng: p1.lng } });
    const t1 = (await assignmentRow(t, id)).lastLocationAt!;
    // A slow request reads the row now (lastLocationAt = t1)...
    const stale = await t.prisma.assignment.findUniqueOrThrow({ where: { id } });
    // ...meanwhile a newer ping is written...
    t.clock.advance(5_000);
    await H.call(api.pro.location, { body: { lat: p2.lat, lng: p2.lng } });
    const t2 = (await assignmentRow(t, id)).lastLocationAt!;
    expect(t2.getTime()).toBeGreaterThan(t1.getTime());
    // ...then the slow one, taken between t1 and t2, finishes its write.
    t.realtime.clearSent();
    const between = new Date(t1.getTime() + 1_000);
    const svc = tracking(t) as unknown as { track(a: unknown, e: LocationEvent): Promise<void> };
    await svc.track(stale, event(job, id, BAKU.ahmadli, between, t.clock.now()));
    const row = await assignmentRow(t, id);
    expect(row.lastLat).toBe(p2.lat);
    expect(row.lastLocationAt!.getTime()).toBe(t2.getTime());
    expect(t.realtime.sentTo(rooms.user(c.userId), 'assignment:location')).toHaveLength(0);
  });
});
