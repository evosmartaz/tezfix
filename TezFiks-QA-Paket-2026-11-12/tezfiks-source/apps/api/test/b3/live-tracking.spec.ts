import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, rooms } from '@tezfiks/shared';
import { createTestApp, type TestApp } from '../helpers/app';
import { BAKU } from '../helpers/factories';
import { along, assignmentRow, geo, setSettings, soloJob } from './helpers';

/**
 * Founder decision (2026-10-26): the customer sees the handyman's live position from acceptance, and the phone numbers
 * unlock from the live ETA (<= contactUnlockEtaSec), whether or not the handyman pressed "Yola çıxdım".
 * Scheduled jobs are tracked from an hour before their time (isLiveTracked in packages/shared/src/policy.ts).
 */
describe('B3 live tracking from acceptance (no "on my way" press needed)', () => {
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

  it('an ACCEPTED job is tracked live: position and ETA reach the customer, and the numbers unlock once the handyman is near', async () => {
    const job = await soloJob(t);
    const { c, h, assignmentId: id } = job;
    const C = t.client(c.token);
    const H = t.client(h.token);
    const from = BAKU.ahmadli; // ~9 km from the request at the centre
    const to = BAKU.center;

    // Far away: live position + ETA for the customer, numbers still locked, status unchanged.
    t.realtime.clearSent();
    t.clock.advance(5_000);
    await H.call(api.pro.location, { body: { lat: from.lat, lng: from.lng } });
    let row = await assignmentRow(t, id);
    expect(row.status).toBe('ACCEPTED');
    expect(row).toMatchObject({ lastLat: from.lat, lastLng: from.lng });
    expect(row.etaSec).toBe(geo(t).fallbackRouteResult(from, to).durationSec);
    expect(row.etaSec!).toBeGreaterThan(300);
    expect(row.contactUnlockedAt).toBeNull();
    expect(t.realtime.sentTo(rooms.user(c.userId), 'assignment:location')).toHaveLength(1);
    expect(t.realtime.sentTo(rooms.assignment(id), 'assignment:location')[0]!.payload).toMatchObject({ assignmentId: id, etaSec: row.etaSec });
    let cv = await C.call(api.assignments.get, { params: { id } });
    expect(cv).toMatchObject({ status: 'ACCEPTED', contactUnlocked: false, providerPhone: null, etaSec: row.etaSec });
    expect(cv.location).toMatchObject({ lat: from.lat, lng: from.lng });

    // Near (98 % of the way): live ETA <= 300 s unlocks both numbers while still ACCEPTED, and the customer is told.
    const near = along(from, to, 0.98);
    t.clock.advance(5_000);
    await H.call(api.pro.location, { body: { lat: near.lat, lng: near.lng } });
    row = await assignmentRow(t, id);
    expect(row.status).toBe('ACCEPTED');
    expect(row.etaSec!).toBeLessThanOrEqual(300);
    expect(row.contactUnlockedAt).not.toBeNull();
    cv = await C.call(api.assignments.get, { params: { id } });
    expect(cv).toMatchObject({ status: 'ACCEPTED', contactUnlocked: true, providerPhone: h.phone, chatEnabled: true });
    const pv = await H.call(api.pro.assignment, { params: { id } });
    expect(pv).toMatchObject({ contactUnlocked: true, customerPhone: c.phone });
    expect(t.realtime.sentTo(rooms.assignment(id), 'assignment:contact')).toHaveLength(1);
    expect(await t.prisma.notification.count({ where: { userId: c.userId, type: 'ASSIGNMENT_NEAR' } })).toBe(1);

    // Pressing "Yola çıxdım" later still works and never relocks.
    const enRoute = await H.call(api.pro.enRoute, { params: { id }, body: { location: near } });
    expect(enRoute).toMatchObject({ status: 'EN_ROUTE', contactUnlocked: true, customerPhone: c.phone });
    expect(await t.prisma.notification.count({ where: { userId: c.userId, type: 'ASSIGNMENT_NEAR' } })).toBe(1);
  });

  it('a scheduled job is not tracked until an hour before its time', async () => {
    const job = await soloJob(t);
    const { c, h, assignmentId: id } = job;
    const H = t.client(h.token);
    const scheduledAt = new Date(t.clock.now().getTime() + 3 * 3_600_000);
    await t.prisma.serviceRequest.update({ where: { id: job.requestId }, data: { timing: 'SCHEDULED', scheduledAt } });
    const near = along(BAKU.ahmadli, BAKU.center, 0.98);

    // Three hours ahead: pings near the address are ignored (no position, no ETA, numbers stay hidden).
    t.realtime.clearSent();
    t.clock.advance(5_000);
    await H.call(api.pro.location, { body: { lat: near.lat, lng: near.lng } });
    let row = await assignmentRow(t, id);
    expect(row).toMatchObject({ status: 'ACCEPTED', lastLat: null, etaSec: null, contactUnlockedAt: null });
    expect(t.realtime.sentTo(rooms.user(c.userId), 'assignment:location')).toHaveLength(0);
    expect((await t.client(c.token).call(api.assignments.get, { params: { id } })).location).toBeNull();

    // 59 minutes before the scheduled time: tracked live, and near enough to unlock. (The job is moved closer instead of
    // the clock, which would expire the pro's 15-minute access token.)
    await t.prisma.serviceRequest.update({ where: { id: job.requestId }, data: { scheduledAt: new Date(t.clock.now().getTime() + 59 * 60_000) } });
    t.clock.advance(5_000);
    await H.call(api.pro.location, { body: { lat: near.lat, lng: near.lng } });
    row = await assignmentRow(t, id);
    expect(row).toMatchObject({ status: 'ACCEPTED', lastLat: near.lat });
    expect(row.etaSec!).toBeLessThanOrEqual(300);
    expect(row.contactUnlockedAt).not.toBeNull();
  });

  it('pings stop counting once the handyman has arrived', async () => {
    const job = await soloJob(t);
    const { h, assignmentId: id } = job;
    const H = t.client(h.token);
    await H.call(api.pro.arrived, { params: { id } });
    const before = await assignmentRow(t, id);
    t.realtime.clearSent();
    t.clock.advance(5_000);
    await H.call(api.pro.location, { body: { lat: BAKU.ahmadli.lat, lng: BAKU.ahmadli.lng } });
    const after = await assignmentRow(t, id);
    expect(after).toMatchObject({ status: 'ARRIVED', lastLat: before.lastLat, etaSec: before.etaSec });
    expect(t.realtime.sentTo(rooms.assignment(id), 'assignment:location')).toHaveLength(0);
  });
});
