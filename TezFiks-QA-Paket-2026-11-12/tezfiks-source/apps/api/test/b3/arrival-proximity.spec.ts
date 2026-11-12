import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, type LatLng } from '@tezfiks/shared';
import { createTestApp, type TestApp } from '../helpers/app';
import { BAKU } from '../helpers/factories';
import { ENV, loadEnv, type Env } from '../../src/config/env';
import { assignmentRow, geo, placeAt, presence, setSettings, soloJob } from './helpers';

/** ~300 m north of the request address (BAKU.center). */
const NEAR_300M: LatLng = { lat: BAKU.center.lat + 0.0027, lng: BAKU.center.lng };

/**
 * Hardening: "Arrived" unlocks the phones and enables the customer's 15 AZN decline. Outside the demo (DEMO_MODE=false) it
 * needs the pro's fresh (<= 5 min) server-side position (presence, never the request body) within arrivalMaxDistanceM of the
 * address; "Yola çıxdım" routes from that position instead of a client-supplied one. The demo keeps the old behaviour
 * (demo phones are not at the address).
 */
describe('B3 arrival proximity (DEMO_MODE=false)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
    expect(t.app.get<Env>(ENV).DEMO_MODE).toBe(false);
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
    await setSettings(t, { minCandidates: 0 });
  });

  it('far from the address: NOT_NEAR_ADDRESS, nothing changes (no unlock, no notification, no customer decline)', async () => {
    const job = await soloJob(t);
    const { c, h, assignmentId: id } = job;
    await placeAt(t, h.handymanId, BAKU.narimanov);
    const H = t.client(h.token);
    await expect(H.call(api.pro.arrived, { params: { id } })).rejects.toMatchObject({ code: 'NOT_NEAR_ADDRESS', status: 409 });
    const row = await assignmentRow(t, id);
    expect(row).toMatchObject({ status: 'ACCEPTED', arrivedAt: null, contactUnlockedAt: null });
    expect(await t.prisma.notification.count({ where: { userId: c.userId, type: 'ASSIGNMENT_ARRIVED' } })).toBe(0);
    const cv = await t.client(c.token).call(api.assignments.get, { params: { id } });
    expect(cv).toMatchObject({ contactUnlocked: false, providerPhone: null });
    await expect(t.client(c.token).call(api.assignments.declineOnArrival, { params: { id }, body: {} })).rejects.toMatchObject({
      code: 'CANCEL_NOT_ALLOWED',
    });
    // The error is translated for the pro app.
    const err = await t
      .client(h.token, 'az')
      .call(api.pro.arrived, { params: { id } })
      .catch((e: unknown) => e as { message: string });
    expect((err as { message: string }).message).toContain('Ünvana yaxın deyilsiniz');
  });

  it('within arrivalMaxDistanceM (default 500 m) of the address: ARRIVED, contact unlocked; a smaller setting refuses the same spot', async () => {
    const job = await soloJob(t);
    const { h, assignmentId: id } = job;
    await placeAt(t, h.handymanId, NEAR_300M);
    await setSettings(t, { arrivalMaxDistanceM: 200 });
    await expect(t.client(h.token).call(api.pro.arrived, { params: { id } })).rejects.toMatchObject({ code: 'NOT_NEAR_ADDRESS' });
    await setSettings(t, { arrivalMaxDistanceM: 500 });
    const pv = await t.client(h.token).call(api.pro.arrived, { params: { id } });
    expect(pv).toMatchObject({ status: 'ARRIVED', contactUnlocked: true });
    // The arrival point is what the customer's map shows.
    expect(await assignmentRow(t, id)).toMatchObject({ lastLat: NEAR_300M.lat, lastLng: NEAR_300M.lng });
    const cv = await t.client(job.c.token).call(api.assignments.get, { params: { id } });
    expect(cv.location).toMatchObject({ lat: NEAR_300M.lat, lng: NEAR_300M.lng });
  });

  it('the default arrivalMaxDistanceM is 500 m', async () => {
    expect((await t.settings.get()).arrivalMaxDistanceM).toBe(500);
  });

  it('a stale position (older than 5 minutes) does not count, a fresh ping near the address does', async () => {
    const job = await soloJob(t);
    const { h, assignmentId: id } = job;
    await placeAt(t, h.handymanId, BAKU.center);
    t.clock.advance(5 * 60_000 + 1_000);
    const H = t.client(h.token);
    await expect(H.call(api.pro.arrived, { params: { id } })).rejects.toMatchObject({ code: 'NOT_NEAR_ADDRESS' });
    // The app's location stream (HTTP ping) refreshes the server-side position.
    await H.call(api.pro.location, { body: { lat: BAKU.center.lat, lng: BAKU.center.lng } });
    await expect(H.call(api.pro.arrived, { params: { id } })).resolves.toMatchObject({ status: 'ARRIVED' });
  });

  it('no server-side position at all (offline, presence gone): NOT_NEAR_ADDRESS', async () => {
    const job = await soloJob(t);
    const { h, assignmentId: id } = job;
    await presence(t).setOffline(h.handymanId);
    await expect(t.client(h.token).call(api.pro.arrived, { params: { id } })).rejects.toMatchObject({ code: 'NOT_NEAR_ADDRESS' });
  });

  it('from EN_ROUTE as well: the client cannot claim to be elsewhere, the route starts at the server-side position', async () => {
    const job = await soloJob(t);
    const { c, h, assignmentId: id } = job;
    await placeAt(t, h.handymanId, BAKU.narimanov);
    const H = t.client(h.token);
    // The body claims "I am at the door"; the server knows the pro is ~2.4 km away and routes from there.
    const pv = await H.call(api.pro.enRoute, { params: { id }, body: { location: BAKU.center } });
    const expected = geo(t).fallbackRouteResult(BAKU.narimanov, BAKU.center);
    expect(pv).toMatchObject({ status: 'EN_ROUTE', contactUnlocked: false, customerPhone: null, etaSec: expected.durationSec });
    expect(pv.route).toMatchObject({ durationSec: expected.durationSec, distanceM: expected.distanceM });
    expect(await assignmentRow(t, id)).toMatchObject({ lastLat: BAKU.narimanov.lat, lastLng: BAKU.narimanov.lng, contactUnlockedAt: null });
    expect((await t.client(c.token).call(api.assignments.get, { params: { id } })).providerPhone).toBeNull();
    await expect(H.call(api.pro.arrived, { params: { id } })).rejects.toMatchObject({ code: 'NOT_NEAR_ADDRESS' });
    expect((await assignmentRow(t, id)).status).toBe('EN_ROUTE');
    // At the door for real: arrived works.
    await placeAt(t, h.handymanId, BAKU.center);
    await expect(H.call(api.pro.arrived, { params: { id } })).resolves.toMatchObject({ status: 'ARRIVED', contactUnlocked: true });
  });

  it('without a fresh server-side position the client location is still used as the route origin', async () => {
    const job = await soloJob(t);
    const { h, assignmentId: id } = job;
    t.clock.advance(5 * 60_000 + 1_000); // the go-online position is stale now
    const pv = await t.client(h.token).call(api.pro.enRoute, { params: { id }, body: { location: BAKU.ahmadli } });
    const expected = geo(t).fallbackRouteResult(BAKU.ahmadli, BAKU.center);
    expect(pv.route).toMatchObject({ durationSec: expected.durationSec });
  });
});

describe('B3 arrival proximity (DEMO_MODE=true keeps the old behaviour)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp((b) => b.overrideProvider(ENV).useValue({ ...loadEnv(), DEMO_MODE: true }));
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
    await setSettings(t, { minCandidates: 0 });
  });

  it('arrives from anywhere and routes from the client-supplied location', async () => {
    const job = await soloJob(t);
    const { h, assignmentId: id } = job;
    await placeAt(t, h.handymanId, BAKU.center);
    const H = t.client(h.token);
    const pv = await H.call(api.pro.enRoute, { params: { id }, body: { location: BAKU.ahmadli } });
    expect(pv.route).toMatchObject({ durationSec: geo(t).fallbackRouteResult(BAKU.ahmadli, BAKU.center).durationSec });
    await placeAt(t, h.handymanId, BAKU.ahmadli);
    await expect(H.call(api.pro.arrived, { params: { id } })).resolves.toMatchObject({ status: 'ARRIVED', contactUnlocked: true });
  });
});
