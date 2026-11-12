import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, rooms } from '@tezfiks/shared';
import { createTestApp, type TestApp } from '../helpers/app';
import { BAKU } from '../helpers/factories';
import { along, assignmentRow, companyJob, setSettings } from './helpers';

/**
 * Hardening: a company manager hands an ACCEPTED job to another worker. Live tracking runs from acceptance, so worker A's
 * position, ETA, route and (when A was near) the contact unlock are on the assignment row. None of it may survive the
 * reassign: the customer must not see A's stale position, and worker B's phone must not be exposed because A was near.
 */
describe('B3 company reassign resets live tracking and the contact unlock', () => {
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

  it('A unlocks via pings, the manager reassigns to B: no position, no ETA, locked contact, no phone; B tracks afresh', async () => {
    const job = await companyJob(t, { workers: 2 });
    const { c, co, worker: a, assignmentId: id } = job;
    const b = co.workers[1]!;
    const A = t.client(a.token);
    const C = t.client(c.token);

    // Worker A drives in: a far ping, then a near one (live ETA <= 300 s unlocks while still ACCEPTED).
    t.clock.advance(5_000);
    await A.call(api.pro.location, { body: { lat: BAKU.ahmadli.lat, lng: BAKU.ahmadli.lng } });
    const near = along(BAKU.ahmadli, BAKU.center, 0.98);
    t.clock.advance(5_000);
    await A.call(api.pro.location, { body: { lat: near.lat, lng: near.lng } });
    let row = await assignmentRow(t, id);
    expect(row.status).toBe('ACCEPTED');
    expect(row.contactUnlockedAt).not.toBeNull();
    expect(row.lastLat).toBe(near.lat);
    let cv = await C.call(api.assignments.get, { params: { id } });
    expect(cv).toMatchObject({ contactUnlocked: true, providerPhone: a.phone });
    expect(cv.location).not.toBeNull();

    t.realtime.clearSent();
    const mv = await t
      .client(co.manager.token)
      .call(api.company.reassign, { params: { companyId: co.companyId, id }, body: { workerId: b.handymanId } });
    expect(mv).toMatchObject({
      status: 'ACCEPTED',
      worker: { handymanId: b.handymanId },
      contactUnlocked: false,
      etaSec: null,
      distanceM: null,
      route: null,
      customerPhone: null,
    });

    row = await assignmentRow(t, id);
    expect(row).toMatchObject({
      handymanId: b.handymanId,
      lastLat: null,
      lastLng: null,
      lastHeading: null,
      lastLocationAt: null,
      etaSec: null,
      etaUpdatedAt: null,
      distanceM: null,
      routePolyline: null,
      routeDurationSec: null,
      routeDistanceM: null,
      routeComputedAt: null,
      routeSource: null,
      contactUnlockedAt: null,
    });

    // The customer view: no stale marker, no ETA, contact locked, no phone of either worker anywhere.
    cv = await C.call(api.assignments.get, { params: { id } });
    expect(cv).toMatchObject({ status: 'ACCEPTED', location: null, etaSec: null, contactUnlocked: false, providerPhone: null, chatEnabled: false });
    const digits = (p: string) => p.replace(/\D/g, '').slice(-7);
    expect(JSON.stringify(cv)).not.toContain(digits(b.phone));
    expect(JSON.stringify(cv)).not.toContain(digits(a.phone));
    // The customer's app is told to re-read the assignment (assignment:updated), so the old marker disappears.
    expect(t.realtime.sentTo(rooms.user(c.userId), 'assignment:updated').length).toBeGreaterThan(0);
    expect(t.realtime.sentTo(rooms.assignment(id), 'assignment:updated').length).toBeGreaterThan(0);
    // Chat is locked again until B is near.
    await expect(C.call(api.chat.send, { params: { id }, body: { body: 'Salam' } })).rejects.toMatchObject({ code: 'CHAT_LOCKED' });

    // A's pings no longer move the job.
    t.clock.advance(5_000);
    await A.call(api.pro.location, { body: { lat: BAKU.center.lat, lng: BAKU.center.lng } });
    expect(await assignmentRow(t, id)).toMatchObject({ lastLat: null, contactUnlockedAt: null });

    // B's own pings track the job from scratch: far first (still locked), then near (unlocks with B's phone).
    t.clock.advance(5_000);
    await t.client(b.token).call(api.pro.location, { body: { lat: BAKU.ahmadli.lat, lng: BAKU.ahmadli.lng } });
    row = await assignmentRow(t, id);
    expect(row.lastLat).toBe(BAKU.ahmadli.lat);
    expect(row.etaSec!).toBeGreaterThan(300);
    expect(row.contactUnlockedAt).toBeNull();
    t.clock.advance(5_000);
    await t.client(b.token).call(api.pro.location, { body: { lat: near.lat, lng: near.lng } });
    expect((await assignmentRow(t, id)).contactUnlockedAt).not.toBeNull();
    cv = await C.call(api.assignments.get, { params: { id } });
    expect(cv).toMatchObject({ contactUnlocked: true, providerPhone: b.phone });
  });
});
