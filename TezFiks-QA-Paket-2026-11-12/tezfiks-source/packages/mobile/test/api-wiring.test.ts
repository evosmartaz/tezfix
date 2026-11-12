import { api, ApiError } from '@tezfiks/shared';
import { createMobileRuntime } from '../src/runtime';
import { newIdempotencyKey } from '../src/api/client';
import { createMemoryStorage, STORAGE_KEYS } from '../src/storage';
import { getApiUrl, socketEndpoint, splitUrl } from '../src/config';
import { createSocket, isAuthConnectError, socketOptions } from '../src/socket';
import { errorCodeOf, errorMessageKey, isAuthError, isNetworkError } from '../src/errors';
import { entryRedirect, resolveEntry } from '../src/auth/route';
import { makeMe } from './fixtures';

const BASE = 'http://10.0.2.2:3000/tezfix/api';

type Handler = (url: string, init: RequestInit) => { status: number; body?: unknown };

function mockFetch(handler: Handler) {
  const calls: Array<{ url: string; init: RequestInit; headers: Record<string, string>; body: unknown }> = [];
  const fn = jest.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const headers = (init.headers ?? {}) as Record<string, string>;
    calls.push({ url, init, headers, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const { status, body } = handler(url, init);
    return new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

const TOKENS = (n: number) => ({
  accessToken: `access-${n}`,
  refreshToken: `refresh-${n}`,
  accessExpiresAt: '2026-10-25T10:15:00.000Z',
  refreshExpiresAt: '2026-11-24T10:00:00.000Z',
});

function errorBody(code: string) {
  return { error: { code, message: code } };
}

describe('API wiring', () => {
  it('sends the bearer token and Accept-Language on authenticated calls', async () => {
    const me = makeMe();
    const { fn, calls } = mockFetch(() => ({ status: 200, body: me }));
    const rt = createMobileRuntime({ app: 'CUSTOMER', apiUrl: BASE, storage: createMemoryStorage(), fetch: fn, getLocale: () => 'ru' });
    await rt.auth.getState().signIn(TOKENS(1), me);
    const out = await rt.api.call(api.me.get);
    expect(out.id).toBe(me.id);
    expect(calls[0].url).toBe(`${BASE}/me`);
    expect(calls[0].headers.Authorization).toBe('Bearer access-1');
    expect(calls[0].headers['Accept-Language']).toBe('ru');
  });

  it('public endpoints carry no Authorization header', async () => {
    const { fn, calls } = mockFetch(() => ({
      status: 200,
      body: { challengeId: 'c1', phone: '+994501234567', expiresAt: '2026-10-25T10:05:00.000Z', resendAfterSec: 60, channel: 'console', devCode: '123456' },
    }));
    const rt = createMobileRuntime({ app: 'PRO', apiUrl: BASE, storage: createMemoryStorage(), fetch: fn, getLocale: () => 'az' });
    await rt.auth.getState().signIn(TOKENS(1), makeMe());
    const res = await rt.api.call(api.auth.otpRequest, { body: { phone: '+994501234567', app: 'PRO', locale: 'az' } });
    expect(res.devCode).toBe('123456');
    expect(calls[0].url).toBe(`${BASE}/auth/otp/request`);
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].headers.Authorization).toBeUndefined();
    expect(calls[0].body).toEqual({ phone: '+994501234567', app: 'PRO', locale: 'az' });
  });

  it('on 401 refreshes once (rotating the stored token) and retries with the new access token', async () => {
    const me = makeMe();
    const { fn, calls } = mockFetch((url, init) => {
      const auth = (init.headers as Record<string, string>).Authorization;
      if (url.endsWith('/auth/refresh')) return { status: 200, body: TOKENS(2) };
      if (url.endsWith('/me')) return auth === 'Bearer access-2' ? { status: 200, body: me } : { status: 401, body: errorBody('UNAUTHORIZED') };
      return { status: 404, body: errorBody('NOT_FOUND') };
    });
    const storage = createMemoryStorage();
    const rt = createMobileRuntime({ app: 'CUSTOMER', apiUrl: BASE, storage, fetch: fn, getLocale: () => 'az' });
    await rt.auth.getState().signIn(TOKENS(1), me);

    await expect(rt.api.call(api.me.get)).resolves.toMatchObject({ id: me.id });
    expect(calls.map((c) => c.url.replace(BASE, ''))).toEqual(['/me', '/auth/refresh', '/me']);
    const refreshCall = calls[1];
    expect(refreshCall.headers.Authorization).toBeUndefined();
    expect(refreshCall.body).toMatchObject({ refreshToken: 'refresh-1' });
    expect((refreshCall.body as { deviceId: string }).deviceId.length).toBeGreaterThanOrEqual(8);
    expect(storage.data.get(STORAGE_KEYS.refreshToken)).toBe('refresh-2');
    expect(rt.auth.getState().accessToken).toBe('access-2');
  });

  it('when the refresh is rejected the user is signed out and caches are cleared', async () => {
    const { fn, calls } = mockFetch((url) => {
      if (url.endsWith('/auth/refresh')) return { status: 401, body: errorBody('REFRESH_INVALID') };
      return { status: 401, body: errorBody('UNAUTHORIZED') };
    });
    const storage = createMemoryStorage();
    const rt = createMobileRuntime({ app: 'CUSTOMER', apiUrl: BASE, storage, fetch: fn, getLocale: () => 'az' });
    await rt.auth.getState().signIn(TOKENS(1), makeMe());
    rt.queryClient.setQueryData(['wallet'], { available: 1000 });

    await expect(rt.api.call(api.me.get)).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
    await new Promise((r) => setTimeout(r, 0));
    expect(rt.auth.getState().status).toBe('signedOut');
    expect(storage.data.has(STORAGE_KEYS.refreshToken)).toBe(false);
    expect(rt.queryClient.getQueryData(['wallet'])).toBeUndefined();
    expect(calls.filter((c) => c.url.endsWith('/auth/refresh'))).toHaveLength(1);
  });

  it('restores a session at startup through the refresh endpoint and /me', async () => {
    const me = makeMe({ customer: { id: 'ca1', type: 'INDIVIDUAL', companyName: null } as never });
    const { fn, calls } = mockFetch((url, init) => {
      if (url.endsWith('/auth/refresh')) return { status: 200, body: TOKENS(9) };
      if (url.endsWith('/me') && (init.headers as Record<string, string>).Authorization === 'Bearer access-9') return { status: 200, body: me };
      return { status: 401, body: errorBody('UNAUTHORIZED') };
    });
    const storage = createMemoryStorage({ [STORAGE_KEYS.refreshToken]: 'refresh-8' });
    const rt = createMobileRuntime({ app: 'CUSTOMER', apiUrl: BASE, storage, fetch: fn, getLocale: () => 'en' });
    await rt.auth.getState().restore();
    expect(rt.auth.getState().status).toBe('signedIn');
    expect(rt.auth.getState().me?.customer?.id).toBe('ca1');
    expect(calls[0].body).toMatchObject({ refreshToken: 'refresh-8' });
    expect(storage.data.get(STORAGE_KEYS.refreshToken)).toBe('refresh-9');
  });

  it('logout calls /auth/logout with the access token and the refresh token', async () => {
    const { fn, calls } = mockFetch(() => ({ status: 200, body: { ok: true } }));
    const storage = createMemoryStorage();
    const rt = createMobileRuntime({ app: 'PRO', apiUrl: BASE, storage, fetch: fn, getLocale: () => 'az' });
    await rt.auth.getState().signIn(TOKENS(3), makeMe());
    await rt.auth.getState().logout();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BASE}/auth/logout`);
    expect(calls[0].headers.Authorization).toBe('Bearer access-3');
    expect(calls[0].body).toEqual({ refreshToken: 'refresh-3' });
    expect(rt.auth.getState().status).toBe('signedOut');
  });

  it('logout with an expired access token refreshes and revokes with the rotated tokens', async () => {
    const { fn, calls } = mockFetch((url, init) => {
      const auth = (init.headers as Record<string, string>).Authorization;
      if (url.endsWith('/auth/refresh')) return { status: 200, body: TOKENS(4) };
      if (url.endsWith('/auth/logout')) return auth === 'Bearer access-4' ? { status: 200, body: { ok: true } } : { status: 401, body: errorBody('UNAUTHORIZED') };
      return { status: 404, body: errorBody('NOT_FOUND') };
    });
    const storage = createMemoryStorage();
    const rt = createMobileRuntime({ app: 'PRO', apiUrl: BASE, storage, fetch: fn, getLocale: () => 'az' });
    await rt.auth.getState().signIn(TOKENS(3), makeMe());
    await rt.auth.getState().logout();
    expect(calls.map((c) => c.url.replace(BASE, ''))).toEqual(['/auth/logout', '/auth/refresh', '/auth/logout']);
    expect(calls[1].body).toMatchObject({ refreshToken: 'refresh-3' });
    expect(calls[2].headers.Authorization).toBe('Bearer access-4');
    expect(calls[2].body).toEqual({ refreshToken: 'refresh-4' });
    expect(rt.auth.getState().status).toBe('signedOut');
    expect(storage.data.has(STORAGE_KEYS.refreshToken)).toBe(false);
  });

  it('a 5xx from /me during restore keeps the session (offline), and retry signs in', async () => {
    const me = makeMe();
    let meStatus = 500;
    const { fn } = mockFetch((url) => {
      if (url.endsWith('/auth/refresh')) return { status: 200, body: TOKENS(9) };
      if (url.endsWith('/me')) return meStatus === 200 ? { status: 200, body: me } : { status: meStatus, body: errorBody('INTERNAL') };
      return { status: 404, body: errorBody('NOT_FOUND') };
    });
    const storage = createMemoryStorage({ [STORAGE_KEYS.refreshToken]: 'refresh-8' });
    const rt = createMobileRuntime({ app: 'CUSTOMER', apiUrl: BASE, storage, fetch: fn, getLocale: () => 'az' });
    await rt.auth.getState().restore();
    expect(rt.auth.getState().status).toBe('offline');
    expect(storage.data.get(STORAGE_KEYS.refreshToken)).toBe('refresh-9');
    meStatus = 200;
    await rt.auth.getState().restore();
    expect(rt.auth.getState().status).toBe('signedIn');
  });

  it('maps network failures to the NETWORK code', async () => {
    const fn = jest.fn(async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;
    const rt = createMobileRuntime({ app: 'CUSTOMER', apiUrl: BASE, storage: createMemoryStorage(), fetch: fn, getLocale: () => 'az' });
    const err = await rt.api.call(api.health.get).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(errorCodeOf(err)).toBe('NETWORK');
    expect(isNetworkError(err)).toBe(true);
  });
});

describe('config and socket wiring', () => {
  it('reads the API URL from expo extra', () => {
    expect(getApiUrl()).toBe(BASE);
  });

  it('splits URLs without the WHATWG URL implementation', () => {
    expect(splitUrl('https://evosmart.az/tezfix/api')).toEqual({ origin: 'https://evosmart.az', pathname: '/tezfix/api' });
    expect(splitUrl('http://10.0.2.2:3000/tezfix/api/')).toEqual({ origin: 'http://10.0.2.2:3000', pathname: '/tezfix/api' });
    expect(splitUrl('http://localhost:3000')).toEqual({ origin: 'http://localhost:3000', pathname: '' });
    expect(() => splitUrl('/relative')).toThrow();
  });

  it('derives the Socket.IO endpoint from the API base (path = api pathname + /socket.io)', () => {
    expect(socketEndpoint(BASE)).toEqual({ url: 'http://10.0.2.2:3000', path: '/tezfix/api/socket.io' });
    expect(socketEndpoint('https://evosmart.az/tezfix/api')).toEqual({ url: 'https://evosmart.az', path: '/tezfix/api/socket.io' });
  });

  it('creates a websocket-only socket that sends the current access token on every handshake', () => {
    let token = 'access-1';
    const ioFactory = jest.fn((_url: string, _opts: Record<string, unknown>) => ({ fake: true }));
    const socket = createSocket({ apiUrl: BASE, getToken: () => token, ioFactory: ioFactory as never });
    expect(socket).toEqual({ fake: true });
    const [url, opts] = ioFactory.mock.calls[0];
    expect(url).toBe('http://10.0.2.2:3000');
    expect(opts).toMatchObject({ path: '/tezfix/api/socket.io', transports: ['websocket'], autoConnect: false, reconnection: true });
    const auth = opts.auth as (cb: (d: object) => void) => void;
    const seen: object[] = [];
    auth((d) => seen.push(d));
    token = 'access-2';
    auth((d) => seen.push(d));
    expect(seen).toEqual([{ token: 'access-1' }, { token: 'access-2' }]);
    expect(socketOptions({ apiUrl: BASE, getToken: () => null }).url).toBe('http://10.0.2.2:3000');
  });

  it('recognizes auth-related connect errors', () => {
    expect(isAuthConnectError({ message: 'UNAUTHORIZED' })).toBe(true);
    expect(isAuthConnectError({ message: 'jwt expired' })).toBe(true);
    expect(isAuthConnectError({ message: 'websocket error' })).toBe(false);
    expect(isAuthConnectError(undefined)).toBe(false);
  });
});

describe('error mapping', () => {
  it('maps API error codes to common.errors keys', () => {
    expect(errorMessageKey(new ApiError(400, 'OTP_INVALID', 'x'))).toBe('common:errors.OTP_INVALID');
    expect(errorMessageKey(new ApiError(0, 'TIMEOUT', 'x'))).toBe('common:errors.TIMEOUT');
    expect(errorMessageKey(new ApiError(500, 'HTTP_502', 'Bad gateway'))).toBe('common:errors.INTERNAL');
    expect(errorMessageKey(new Error('boom'))).toBe('common:errors.INTERNAL');
    expect(errorMessageKey({ code: 'INSUFFICIENT_BALANCE' })).toBe('common:errors.INSUFFICIENT_BALANCE');
    expect(errorMessageKey(null)).toBe('common:errors.INTERNAL');
  });

  it('classifies auth and network errors', () => {
    expect(isAuthError(new ApiError(401, 'SESSION_REVOKED', 'x'))).toBe(true);
    expect(isAuthError(new ApiError(409, 'INVALID_STATE', 'x'))).toBe(false);
    expect(isNetworkError(new ApiError(0, 'NETWORK', 'x'))).toBe(true);
  });
});

describe('entry routing', () => {
  const base = makeMe();
  it('routes by session and profile state', () => {
    expect(resolveEntry('CUSTOMER', 'idle', null)).toBe('loading');
    expect(resolveEntry('CUSTOMER', 'restoring', null)).toBe('loading');
    expect(resolveEntry('CUSTOMER', 'offline', null)).toBe('offline');
    expect(resolveEntry('CUSTOMER', 'signedOut', null)).toBe('auth');
    expect(resolveEntry('CUSTOMER', 'signedIn', null)).toBe('loading');
    expect(resolveEntry('CUSTOMER', 'signedIn', { ...base, profileComplete: false })).toBe('profile');
    expect(resolveEntry('PRO', 'signedIn', { ...base, profileComplete: false })).toBe('profile');
  });

  it('customer goes to account type until a customer account exists', () => {
    expect(resolveEntry('CUSTOMER', 'signedIn', base)).toBe('onboarding');
    expect(resolveEntry('CUSTOMER', 'signedIn', { ...base, customer: { id: 'c', type: 'COMPANY', companyName: 'Kontur MMC' } as never })).toBe('main');
  });

  it('pro goes to "Usta kimi qoşulun" until a handyman profile or a managed company exists', () => {
    expect(resolveEntry('PRO', 'signedIn', base)).toBe('onboarding');
    expect(
      resolveEntry('PRO', 'signedIn', { ...base, handyman: { id: 'h', kind: 'SOLO', status: 'PENDING_REVIEW', companyId: null, isOnline: false } as never }),
    ).toBe('main');
    expect(
      resolveEntry('PRO', 'signedIn', {
        ...base,
        companies: [{ companyId: 'co', companyName: 'FixPro MMC', role: 'MANAGER', companyStatus: 'APPROVED' } as never],
      }),
    ).toBe('main');
    expect(
      resolveEntry('PRO', 'signedIn', {
        ...base,
        companies: [{ companyId: 'co', companyName: 'FixPro MMC', role: 'WORKER', companyStatus: 'APPROVED' } as never],
      }),
    ).toBe('onboarding');
  });
});

describe('entry redirects', () => {
  const routes = {
    auth: { segment: '(auth)', href: '/phone' },
    profile: { segment: 'profile-setup', href: '/profile-setup' },
    onboarding: { segment: 'account-type', href: '/account-type' },
    offline: { segment: 'offline', href: '/offline' },
    main: { href: '/' },
  };

  it('keeps the user in place while loading', () => {
    expect(entryRedirect('loading', '(tabs)', routes)).toBeNull();
    expect(entryRedirect('loading', undefined, routes)).toBeNull();
  });

  it('sends signed-out users to the login flow from anywhere except the login flow', () => {
    expect(entryRedirect('auth', '(tabs)', routes)).toBe('/phone');
    expect(entryRedirect('auth', 'requests', routes)).toBe('/phone');
    expect(entryRedirect('auth', '(auth)', routes)).toBeNull();
  });

  it('forces profile completion and onboarding', () => {
    expect(entryRedirect('profile', '(auth)', routes)).toBe('/profile-setup');
    expect(entryRedirect('profile', 'profile-setup', routes)).toBeNull();
    expect(entryRedirect('onboarding', 'profile-setup', routes)).toBe('/account-type');
    expect(entryRedirect('onboarding', 'account-type', routes)).toBeNull();
    expect(entryRedirect('offline', '(tabs)', routes)).toBe('/offline');
  });

  it('moves signed-in users out of gate screens only', () => {
    expect(entryRedirect('main', '(auth)', routes)).toBe('/');
    expect(entryRedirect('main', 'account-type', routes)).toBe('/');
    expect(entryRedirect('main', 'offline', routes)).toBe('/');
    expect(entryRedirect('main', undefined, routes)).toBe('/');
    expect(entryRedirect('main', '(tabs)', routes)).toBeNull();
    expect(entryRedirect('main', 'requests', routes)).toBeNull();
  });

  it('lets a gate allow extra routes (pro invite link while onboarding) without opening anything else', () => {
    const pro = {
      ...routes,
      onboarding: { segment: 'onboarding', href: '/onboarding', allow: ['join'] },
    };
    expect(entryRedirect('onboarding', 'join', pro)).toBeNull();
    expect(entryRedirect('onboarding', '(tabs)', pro)).toBe('/onboarding');
    expect(entryRedirect('onboarding', undefined, pro)).toBe('/onboarding');
    // The allow-list belongs to its gate only: signed-out users still go to login.
    expect(entryRedirect('auth', 'join', pro)).toBe('/phone');
    // Signed-in users can open the invite route too (it is not a gate screen).
    expect(entryRedirect('main', 'join', pro)).toBeNull();
  });
});

describe('idempotency keys', () => {
  it('idempotent endpoints get a UUID key; a retry with the same key keeps it; the 401 retry reuses it', async () => {
    let first = true;
    const { fn, calls } = mockFetch((url) => {
      if (url.endsWith('/auth/refresh')) return { status: 200, body: TOKENS(2) };
      if (first) {
        first = false;
        return { status: 401, body: errorBody('UNAUTHORIZED') };
      }
      return { status: 200, body: { paymentIntentId: 'pi1', checkoutUrl: 'http://x/checkout' } };
    });
    const rt = createMobileRuntime({ app: 'CUSTOMER', apiUrl: BASE, storage: createMemoryStorage(), fetch: fn, getLocale: () => 'az' });
    await rt.auth.getState().signIn(TOKENS(1), makeMe());
    await rt.api.call(api.wallet.topup, { body: { amount: 5000 } });
    const topups = calls.filter((c) => c.url.endsWith('/wallet/topup'));
    expect(topups).toHaveLength(2);
    expect(topups[0].headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(topups[1].headers['Idempotency-Key']).toBe(topups[0].headers['Idempotency-Key']);

    await rt.api.call(api.wallet.topup, { body: { amount: 5000 }, idempotencyKey: 'topup:user-chosen' });
    expect(calls[calls.length - 1].headers['Idempotency-Key']).toBe('topup:user-chosen');
    expect(newIdempotencyKey()).not.toBe(newIdempotencyKey());
  });
});
