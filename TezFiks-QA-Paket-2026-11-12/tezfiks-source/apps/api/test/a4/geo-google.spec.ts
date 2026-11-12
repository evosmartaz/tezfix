import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api } from '@tezfiks/shared';
import { createTestApp, type TestApp } from '../helpers/app';
import { BAKU, createCustomer } from '../helpers/factories';
import { ENV, loadEnv } from '../../src/config/env';
import { GEO_FETCH, GeoService } from '../../src/modules/geo/geo.service';
import { createFakeFetch, jsonResponse } from './helpers';

const KEY = 'test-maps-key';
const fake = createFakeFetch();
let t: TestApp;
let geo: GeoService;
let token: string;

beforeAll(async () => {
  t = await createTestApp((b) =>
    b
      .overrideProvider(ENV)
      .useValue({ ...loadEnv(), GOOGLE_MAPS_SERVER_KEY: KEY })
      .overrideProvider(GEO_FETCH)
      .useValue(fake.fn),
  );
  geo = t.app.get(GeoService);
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  fake.reset();
  token = (await createCustomer(t)).token;
});

const geocodeOk = {
  status: 'OK',
  results: [
    {
      formatted_address: 'Nizami küçəsi 10, Bakı, Azərbaycan',
      place_id: 'ChIJ-geocode',
      address_components: [
        { long_name: '10', short_name: '10', types: ['street_number'] },
        { long_name: 'Nizami küçəsi', short_name: 'Nizami küç.', types: ['route'] },
        { long_name: 'Səbail rayonu', short_name: 'Səbail', types: ['sublocality_level_1', 'sublocality', 'political'] },
        { long_name: 'Bakı', short_name: 'Bakı', types: ['locality', 'political'] },
      ],
    },
  ],
};

describe('reverse geocoding via Google', () => {
  it('calls the Geocoding API with the key and the caller language and maps the address', async () => {
    fake.respond(() => jsonResponse(geocodeOk));
    const out = await t.client(token, 'ru').call(api.geo.reverse, { query: { lat: 40.3777, lng: 49.8531 } });
    expect(out).toEqual({
      lat: 40.3777,
      lng: 49.8531,
      formatted: 'Nizami küçəsi 10, Bakı, Azərbaycan',
      placeId: 'ChIJ-geocode',
      district: 'Səbail rayonu',
      street: 'Nizami küçəsi',
      building: '10',
      source: 'google',
    });
    expect(fake.calls).toHaveLength(1);
    const url = new URL(fake.calls[0]!.url);
    expect(`${url.origin}${url.pathname}`).toBe('https://maps.googleapis.com/maps/api/geocode/json');
    expect(url.searchParams.get('latlng')).toBe('40.3777,49.8531');
    expect(url.searchParams.get('language')).toBe('ru');
    expect(url.searchParams.get('key')).toBe(KEY);
    expect(fake.calls[0]!.method).toBe('GET');
    expect(fake.calls[0]!.signal).toBeInstanceOf(AbortSignal);
  });

  it('uses the district table when Google has no district component', async () => {
    fake.respond(() =>
      jsonResponse({ status: 'OK', results: [{ formatted_address: 'Bakı', place_id: 'p1', address_components: [{ long_name: 'Bakı', types: ['locality'] }] }] }),
    );
    const out = await t.client(token, 'en').call(api.geo.reverse, { query: { lat: BAKU.narimanov.lat, lng: BAKU.narimanov.lng } });
    expect(out).toMatchObject({ source: 'google', formatted: 'Bakı', district: 'Narimanov district', street: null, building: null });
  });

  it('falls back on ZERO_RESULTS, HTTP errors, network errors and denied keys', async () => {
    const answers: Array<() => Response | Promise<Response>> = [
      () => jsonResponse({ status: 'ZERO_RESULTS', results: [] }),
      () => jsonResponse({ error: 'boom' }, 500),
      () => {
        throw new TypeError('fetch failed');
      },
      () => jsonResponse({ status: 'REQUEST_DENIED', results: [] }),
      () => new Response('not json', { status: 200 }),
    ];
    for (const answer of answers) {
      fake.respond(answer);
      const out = await t.client(token).call(api.geo.reverse, { query: { lat: 40.3777, lng: 49.8531 } });
      expect(out).toMatchObject({ source: 'fallback', formatted: '40.37770, 49.85310', district: 'Səbail rayonu', placeId: null });
    }
    expect(fake.calls).toHaveLength(answers.length);
  });

  it('times out after 5 seconds and falls back', async () => {
    fake.respond(
      (call) =>
        new Promise<Response>((_resolve, reject) => {
          call.signal!.addEventListener('abort', () => reject(call.signal!.reason));
        }),
    );
    const started = Date.now();
    const out = await geo.reverse(40.3777, 49.8531, 'az');
    const elapsed = Date.now() - started;
    expect(out.source).toBe('fallback');
    expect(elapsed).toBeGreaterThanOrEqual(4_500);
    expect(elapsed).toBeLessThan(9_000);
  }, 20_000);
});

describe('Places autocomplete (New)', () => {
  const suggestions = {
    suggestions: [
      {
        placePrediction: {
          placeId: 'ChIJ-1',
          text: { text: 'Gənclik Mall, Fətəli Xan Xoyski, Bakı' },
          structuredFormat: { mainText: { text: 'Gənclik Mall' }, secondaryText: { text: 'Fətəli Xan Xoyski, Bakı' } },
        },
      },
      { placePrediction: { placeId: 'ChIJ-2', text: { text: 'Gənclik' } } },
      { queryPrediction: { text: { text: 'gənclik metro' } } },
    ],
  };

  it('posts the query with key, field mask, session token, language, region and a 30 km bias circle', async () => {
    fake.respond(() => jsonResponse(suggestions));
    const out = await t.client(token, 'en').call(api.geo.autocomplete, {
      query: { q: 'Gənclik', sessionToken: 'sess-token-123', lat: 40.4, lng: 49.85 },
    });
    expect(out).toEqual({
      items: [
        { placeId: 'ChIJ-1', primary: 'Gənclik Mall', secondary: 'Fətəli Xan Xoyski, Bakı' },
        { placeId: 'ChIJ-2', primary: 'Gənclik', secondary: null },
      ],
      source: 'google',
    });
    const call = fake.calls[0]!;
    expect(call.url).toBe('https://places.googleapis.com/v1/places:autocomplete');
    expect(call.method).toBe('POST');
    expect(call.headers['x-goog-api-key']).toBe(KEY);
    expect(call.headers['x-goog-fieldmask']).toContain('suggestions.placePrediction.placeId');
    expect(call.headers['content-type']).toBe('application/json');
    expect(call.body).toEqual({
      input: 'Gənclik',
      sessionToken: 'sess-token-123',
      languageCode: 'en',
      includedRegionCodes: ['az'],
      locationBias: { circle: { center: { latitude: 40.4, longitude: 49.85 }, radius: 30_000 } },
    });
  });

  it('biases to the Baku centre when no location is given', async () => {
    fake.respond(() => jsonResponse({}));
    const out = await t.client(token, 'az').call(api.geo.autocomplete, { query: { q: 'Nərimanov', sessionToken: 'sess-token-123' } });
    expect(out).toEqual({ items: [], source: 'google' });
    expect((fake.calls[0]!.body as any).locationBias.circle.center).toEqual({ latitude: 40.3777, longitude: 49.8531 });
    expect((fake.calls[0]!.body as any).languageCode).toBe('az');
  });

  it('falls back to an empty list on errors', async () => {
    fake.respond(() => jsonResponse({ error: { code: 403 } }, 403));
    const out = await t.client(token).call(api.geo.autocomplete, { query: { q: 'Nərimanov', sessionToken: 'sess-token-123' } });
    expect(out).toEqual({ items: [], source: 'fallback' });
  });
});

describe('Place Details (New)', () => {
  it('requests the field mask, language and session token and maps the place', async () => {
    fake.respond(() =>
      jsonResponse({
        id: 'ChIJ-1',
        location: { latitude: 40.4001, longitude: 49.8512 },
        formattedAddress: 'Fətəli Xan Xoyski 14, Bakı, Azərbaycan',
        addressComponents: [
          { longText: '14', shortText: '14', types: ['street_number'] },
          { longText: 'Fətəli Xan Xoyski küçəsi', shortText: 'F. X. Xoyski', types: ['route'] },
          { longText: 'Nərimanov rayonu', shortText: 'Nərimanov', types: ['sublocality_level_1', 'political'] },
        ],
      }),
    );
    const out = await t.client(token, 'az').call(api.geo.place, { params: { placeId: 'ChIJ-1' }, query: { sessionToken: 'sess-token-123' } });
    expect(out).toEqual({
      lat: 40.4001,
      lng: 49.8512,
      formatted: 'Fətəli Xan Xoyski 14, Bakı, Azərbaycan',
      placeId: 'ChIJ-1',
      district: 'Nərimanov rayonu',
      street: 'Fətəli Xan Xoyski küçəsi',
      building: '14',
      source: 'google',
    });
    const call = fake.calls[0]!;
    const url = new URL(call.url);
    expect(`${url.origin}${url.pathname}`).toBe('https://places.googleapis.com/v1/places/ChIJ-1');
    expect(url.searchParams.get('languageCode')).toBe('az');
    expect(url.searchParams.get('sessionToken')).toBe('sess-token-123');
    expect(call.headers['x-goog-api-key']).toBe(KEY);
    expect(call.headers['x-goog-fieldmask']).toBe('id,location,formattedAddress,addressComponents');
  });

  it('encodes the place id in the path', async () => {
    fake.respond(() => jsonResponse({ id: 'a/b', location: { latitude: 40.4, longitude: 49.8 } }));
    const out = await t.client(token).call(api.geo.place, { params: { placeId: 'a/b?x=1' } });
    expect(new URL(fake.calls[0]!.url).pathname).toBe('/v1/places/a%2Fb%3Fx%3D1');
    expect(out.formatted).toBe('40.40000, 49.80000');
  });

  it('returns NOT_FOUND when Google cannot resolve the place', async () => {
    fake.respond(() => jsonResponse({ error: { code: 404 } }, 404));
    await expect(t.client(token).call(api.geo.place, { params: { placeId: 'missing' } })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    fake.respond(() => jsonResponse({ id: 'x' }));
    await expect(t.client(token).call(api.geo.place, { params: { placeId: 'nolocation' } })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('Routes API computeRoutes', () => {
  it('posts origin/destination with the field mask and traffic preference and maps the route', async () => {
    t.clock.set('2026-10-25T09:30:00.000Z');
    fake.respond(() => jsonResponse({ routes: [{ duration: '754s', distanceMeters: 6123, polyline: { encodedPolyline: 'abc_def' } }] }));
    const before = t.clock.nowMs();
    const r = await geo.route(BAKU.center, BAKU.narimanov, { trafficAware: true });
    const after = t.clock.nowMs();
    expect(r).toMatchObject({ polyline: 'abc_def', durationSec: 754, distanceM: 6123, source: 'google' });
    expect(r.computedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(r.computedAt.getTime()).toBeLessThanOrEqual(after);
    const call = fake.calls[0]!;
    expect(call.url).toBe('https://routes.googleapis.com/directions/v2:computeRoutes');
    expect(call.method).toBe('POST');
    expect(call.headers['x-goog-api-key']).toBe(KEY);
    expect(call.headers['x-goog-fieldmask']).toBe('routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline');
    expect(call.body).toEqual({
      origin: { location: { latLng: { latitude: BAKU.center.lat, longitude: BAKU.center.lng } } },
      destination: { location: { latLng: { latitude: BAKU.narimanov.lat, longitude: BAKU.narimanov.lng } } },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE',
      polylineEncoding: 'ENCODED_POLYLINE',
    });

    await geo.route(BAKU.center, BAKU.narimanov);
    expect((fake.calls[1]!.body as any).routingPreference).toBe('TRAFFIC_UNAWARE');
  });

  it('falls back when the API fails or returns no route', async () => {
    for (const answer of [() => jsonResponse({}, 503), () => jsonResponse({ routes: [] }), () => jsonResponse({ routes: [{ distanceMeters: 5 }] })]) {
      fake.respond(answer);
      const r = await geo.route(BAKU.center, BAKU.ahmadli);
      expect(r.source).toBe('fallback');
      expect(r.distanceM).toBeGreaterThan(11_000);
    }
  });

  it('reports maps as enabled', () => {
    expect(geo.mapsEnabled).toBe(true);
  });
});
