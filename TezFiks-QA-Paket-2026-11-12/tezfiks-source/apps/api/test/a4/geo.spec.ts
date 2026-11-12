import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { latLngToCell } from 'h3-js';
import { api, decodePolyline, encodePolyline, fallbackRoute, haversineMeters } from '@tezfiks/shared';
import { createTestApp, type TestApp } from '../helpers/app';
import { BAKU, adminToken, createCustomer } from '../helpers/factories';
import { GeoService } from '../../src/modules/geo/geo.service';
import { BAKU_DISTRICTS, nearestBakuDistrict } from '../../src/modules/geo/baku-districts';

let t: TestApp;
let geo: GeoService;
beforeAll(async () => {
  t = await createTestApp();
  geo = t.app.get(GeoService);
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
});

describe('geo endpoints without a Google key (fallbacks)', () => {
  it('reverse returns coordinates as text and the nearest Baku district in the caller language', async () => {
    const c = await createCustomer(t);
    const az = await t.client(c.token, 'az').call(api.geo.reverse, { query: { lat: 40.3777, lng: 49.8531 } });
    expect(az).toEqual({
      lat: 40.3777,
      lng: 49.8531,
      formatted: '40.37770, 49.85310',
      placeId: null,
      district: 'Səbail rayonu',
      street: null,
      building: null,
      source: 'fallback',
    });
    const ru = await t.client(c.token, 'ru').call(api.geo.reverse, { query: { lat: BAKU.narimanov.lat, lng: BAKU.narimanov.lng } });
    expect(ru.district).toBe('Наримановский район');
    expect(ru.formatted).toBe('40.40260, 49.87120');
    const en = await t.client(c.token, 'en').call(api.geo.reverse, { query: { lat: BAKU.ahmadli.lat, lng: BAKU.ahmadli.lng } });
    expect(en.district).toBe('Khatai district');
  });

  it('reverse far from Baku has no district', async () => {
    const c = await createCustomer(t);
    const out = await t.client(c.token).call(api.geo.reverse, { query: { lat: 40.6828, lng: 46.3606 } });
    expect(out.district).toBeNull();
    expect(out.formatted).toBe('40.68280, 46.36060');
  });

  it('autocomplete returns no items and source fallback', async () => {
    const c = await createCustomer(t);
    const out = await t.client(c.token).call(api.geo.autocomplete, { query: { q: 'Nizami küç', sessionToken: 'session-token-1' } });
    expect(out).toEqual({ items: [], source: 'fallback' });
  });

  it('place cannot be resolved without maps', async () => {
    const c = await createCustomer(t);
    await expect(t.client(c.token).call(api.geo.place, { params: { placeId: 'ChIJabc' } })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  it('validates input', async () => {
    const c = await createCustomer(t);
    await expect(t.client(c.token).call(api.geo.autocomplete, { query: { q: 'a', sessionToken: 'session-token-1' } })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(t.client(c.token).call(api.geo.reverse, { query: { lat: 91, lng: 49 } })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('requires a user token (no admin, no anonymous)', async () => {
    await expect(t.client(null).call(api.geo.reverse, { query: { lat: 40.4, lng: 49.8 } })).rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401 });
    const { token } = await adminToken(t);
    await expect(t.client(token).call(api.geo.reverse, { query: { lat: 40.4, lng: 49.8 } })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
  });

  it('rate limits geo calls to 60 per user per minute', async () => {
    const a = await createCustomer(t);
    const b = await createCustomer(t);
    const client = t.client(a.token);
    for (let i = 0; i < 60; i++) {
      if (i % 3 === 0) await client.call(api.geo.reverse, { query: { lat: 40.4, lng: 49.8 } });
      else if (i % 3 === 1) await client.call(api.geo.autocomplete, { query: { q: 'Gənclik', sessionToken: 'session-token-1' } });
      else await client.call(api.geo.reverse, { query: { lat: 40.41, lng: 49.81 } });
    }
    await expect(client.call(api.geo.reverse, { query: { lat: 40.4, lng: 49.8 } })).rejects.toMatchObject({ code: 'RATE_LIMITED', status: 429 });
    await expect(client.call(api.geo.place, { params: { placeId: 'x' } })).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    // another user is not affected
    await expect(t.client(b.token).call(api.geo.reverse, { query: { lat: 40.4, lng: 49.8 } })).resolves.toMatchObject({ source: 'fallback' });
  });
});

describe('GeoService without a key', () => {
  it('route falls back to a straight polyline with haversine x 1.35 at 25 km/h', async () => {
    t.clock.set('2026-10-25T10:00:00.000Z');
    const before = t.clock.nowMs();
    const r = await geo.route(BAKU.center, BAKU.ahmadli, { trafficAware: true });
    const after = t.clock.nowMs();
    const straight = haversineMeters(BAKU.center, BAKU.ahmadli);
    expect(r.source).toBe('fallback');
    expect(r.distanceM).toBe(Math.round(straight * 1.35));
    expect(r.durationSec).toBe(Math.round(r.distanceM / (25_000 / 3600)));
    expect(r).toMatchObject(fallbackRoute(BAKU.center, BAKU.ahmadli));
    // computedAt comes from the business Clock (moved to 2026-10-25), not the wall clock
    expect(r.computedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(r.computedAt.getTime()).toBeLessThanOrEqual(after);
    expect(r.computedAt.toISOString().slice(0, 16)).toBe('2026-10-25T10:00');
    const pts = decodePolyline(r.polyline);
    expect(pts).toHaveLength(2);
    expect(pts[0]!.lat).toBeCloseTo(BAKU.center.lat, 5);
    expect(pts[1]!.lng).toBeCloseTo(BAKU.ahmadli.lng, 5);
    // ~9 km straight -> ~12.4 km by road, ~30 minutes
    expect(r.distanceM).toBeGreaterThan(11_000);
    expect(r.distanceM).toBeLessThan(14_000);
  });

  it('route between identical points is zero', async () => {
    const r = await geo.route(BAKU.center, BAKU.center);
    expect(r.distanceM).toBe(0);
    expect(r.durationSec).toBe(0);
  });

  it('progressAlong snaps to the closest segment and scales the remaining time', () => {
    // Three points due north, ~1112 m apart.
    const path = [
      { lat: 40.37, lng: 49.85 },
      { lat: 40.38, lng: 49.85 },
      { lat: 40.39, lng: 49.85 },
    ];
    const polyline = encodePolyline(path);
    const seg = haversineMeters(path[0]!, path[1]!);
    const total = seg + haversineMeters(path[1]!, path[2]!);
    // midpoint of the first segment, 100 m east of the route
    const lngPer100m = 100 / (111_195 * Math.cos((40.375 * Math.PI) / 180));
    const p = geo.progressAlong(polyline, { lat: 40.375, lng: 49.85 + lngPer100m }, 600);
    expect(p.offRouteM).toBeGreaterThanOrEqual(98);
    expect(p.offRouteM).toBeLessThanOrEqual(102);
    expect(Math.abs(p.remainingDistanceM - (seg / 2 + seg))).toBeLessThanOrEqual(3);
    expect(Math.abs(p.remainingSec - Math.round((600 * (seg * 1.5)) / total))).toBeLessThanOrEqual(1);

    // at the start: everything remains
    const start = geo.progressAlong(polyline, path[0]!, 600);
    expect(start.offRouteM).toBe(0);
    expect(Math.abs(start.remainingDistanceM - total)).toBeLessThanOrEqual(1);
    expect(start.remainingSec).toBe(600);

    // past the end: nothing remains, off-route distance measured to the last point
    const beyond = { lat: 40.395, lng: 49.85 };
    const end = geo.progressAlong(polyline, beyond, 600);
    expect(end.remainingDistanceM).toBe(0);
    expect(end.remainingSec).toBe(0);
    expect(Math.abs(end.offRouteM - haversineMeters(beyond, path[2]!))).toBeLessThanOrEqual(2);

    // on the second segment, a quarter of the way
    const q = geo.progressAlong(polyline, { lat: 40.3825, lng: 49.85 }, 600);
    expect(Math.abs(q.remainingDistanceM - seg * 0.75)).toBeLessThanOrEqual(3);
    expect(q.offRouteM).toBeLessThanOrEqual(1);
  });

  it('progressAlong on a fallback route and degenerate polylines', async () => {
    const r = await geo.route(BAKU.center, BAKU.narimanov);
    const half = { lat: (BAKU.center.lat + BAKU.narimanov.lat) / 2, lng: (BAKU.center.lng + BAKU.narimanov.lng) / 2 };
    const p = geo.progressAlong(r.polyline, half, r.durationSec);
    expect(Math.abs(p.remainingSec - r.durationSec / 2)).toBeLessThanOrEqual(2);
    expect(p.offRouteM).toBeLessThanOrEqual(2);

    expect(geo.progressAlong('', BAKU.center, 100)).toEqual({ remainingDistanceM: 0, remainingSec: 0, offRouteM: 0 });
    const single = geo.progressAlong(encodePolyline([BAKU.center]), BAKU.narimanov, 100);
    expect(single.remainingDistanceM).toBe(0);
    expect(Math.abs(single.offRouteM - haversineMeters(BAKU.center, BAKU.narimanov))).toBeLessThanOrEqual(2);
  });

  it('H3 helpers return resolution 7 and 9 cells', () => {
    const c7 = geo.cell7(BAKU.center.lat, BAKU.center.lng);
    const c9 = geo.cell9(BAKU.center.lat, BAKU.center.lng);
    expect(c7).toBe(latLngToCell(BAKU.center.lat, BAKU.center.lng, 7));
    expect(c9).toBe(latLngToCell(BAKU.center.lat, BAKU.center.lng, 9));
    expect(c7).toMatch(/^[0-9a-f]{15}$/);
    expect(c9).toMatch(/^[0-9a-f]{15}$/);
    expect(c7).not.toBe(c9);
  });

  it('the district table has the 12 Baku raions in three languages', () => {
    expect(BAKU_DISTRICTS).toHaveLength(12);
    for (const d of BAKU_DISTRICTS) {
      expect(d.names.az && d.names.ru && d.names.en).toBeTruthy();
      expect(nearestBakuDistrict(d.centroid)?.slug).toBe(d.slug);
    }
    expect(nearestBakuDistrict({ lat: 40.4093, lng: 49.8671 })?.slug).toBe('narimanov');
  });
});
