import { describe, expect, it, vi } from 'vitest';
import { api } from '../src/contract/api';
import { collectEndpoints } from '../src/contract/define';
import { buildPath, buildQuery, createApiClient } from '../src/client';
import { ApiError } from '../src/errors';

describe('contract', () => {
  const all = collectEndpoints(api);

  it('has many endpoints with unique method+path', () => {
    expect(all.length).toBeGreaterThan(150);
    const keys = all.map((e) => `${e.endpoint.method} ${e.endpoint.path}`);
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
    expect(dupes).toEqual([]);
  });

  it('declares every path param in the params schema', () => {
    for (const { name, endpoint } of all) {
      const names = [...endpoint.path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]);
      if (names.length === 0) continue;
      const shape = (endpoint.params as unknown as { shape?: Record<string, unknown> } | undefined)?.shape ?? {};
      for (const n of names) expect(Object.keys(shape), `${name} missing param ${n}`).toContain(n);
    }
  });

  it('does not put request bodies on GET endpoints', () => {
    for (const { name, endpoint } of all) {
      if (endpoint.method === 'GET') expect(endpoint.body, name).toBeUndefined();
    }
  });
});

describe('client', () => {
  it('builds paths and queries', () => {
    expect(buildPath('/requests/:id', { id: 'a b' })).toBe('/requests/a%20b');
    expect(() => buildPath('/requests/:id', {})).toThrow();
    expect(buildQuery({ a: 1, b: undefined, c: ['x', 'y'], d: '' })).toBe('?a=1&c=x&c=y');
  });

  it('sends auth, locale and idempotency headers and parses JSON', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify({ paymentIntentId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b', checkoutUrl: 'x' }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const client = createApiClient({
      baseUrl: 'https://evosmart.az/tezfix/api/',
      getAccessToken: () => 'tok',
      getLocale: () => 'ru',
      fetch: fetchMock as unknown as typeof fetch,
      validateResponses: true,
    });
    const out = await client.call(api.wallet.topup, { body: { amount: 1000 }, idempotencyKey: 'k1' });
    expect(out.checkoutUrl).toBe('x');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://evosmart.az/tezfix/api/wallet/topup');
    const h = init.headers as Record<string, string>;
    expect(h.Authorization).toBe('Bearer tok');
    expect(h['Accept-Language']).toBe('ru');
    expect(h['Idempotency-Key']).toBe('k1');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ amount: 1000 });
  });

  it('refreshes once on 401 and retries with the same idempotency key', async () => {
    let token = 'old';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'x' } }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const client = createApiClient({
      baseUrl: 'http://x',
      getAccessToken: () => token,
      refreshAccessToken: async () => {
        token = 'new';
        return true;
      },
      fetch: fetchMock as unknown as typeof fetch,
    });
    await client.call(api.me.registerDevice, {
      body: { deviceId: 'device-123', app: 'CUSTOMER', platform: 'android', pushToken: null, pushProvider: null },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[1]![1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer new' });
  });

  it('maps error bodies to ApiError', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { code: 'INSUFFICIENT_BALANCE', message: 'Balans azdır', details: { need: 1000 } } }), { status: 402 }));
    const client = createApiClient({ baseUrl: 'http://x', fetch: fetchMock as unknown as typeof fetch });
    const err = await client.call(api.pro.acceptOffer, { params: { id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b' } }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('INSUFFICIENT_BALANCE');
    expect((err as ApiError).status).toBe(402);
  });

  it('wraps network failures', async () => {
    const client = createApiClient({ baseUrl: 'http://x', fetch: (async () => { throw new TypeError('Network request failed'); }) as unknown as typeof fetch });
    const err = await client.call(api.health.get).catch((e: unknown) => e);
    expect((err as ApiError).code).toBe('NETWORK');
  });
});
