import { describe, expect, it } from 'vitest';
import {
  ACCESS_COOKIE,
  ACCESS_REFRESH_SKEW_MS,
  DEVICE_COOKIE,
  KIND_COOKIE,
  LOCALE_COOKIE,
  REFRESH_COOKIE,
  clearedSessionCookies,
  deviceCookie,
  isAccessTokenFresh,
  isLoginPath,
  isValidDeviceId,
  jwtExpiryMs,
  localeCookie,
  loginPathFor,
  newDeviceId,
  panelArea,
  safeNextPath,
  sessionCookies,
  sessionState,
} from '@/lib/session/cookies';
import { makeJwt, makeTokens } from './helpers';

const NOW = Date.parse('2026-10-25T10:00:00.000Z');

describe('session cookies', () => {
  it('uses the names tf_at / tf_rt / tf_kind', () => {
    expect([ACCESS_COOKIE, REFRESH_COOKIE, KIND_COOKIE]).toEqual(['tf_at', 'tf_rt', 'tf_kind']);
  });

  it('writes httpOnly, SameSite=Lax cookies on path /tezfix with the token expiries', () => {
    const tokens = makeTokens(NOW);
    const cookies = sessionCookies(tokens, 'admin', false);
    expect(cookies.map((c) => c.name)).toEqual(['tf_at', 'tf_rt', 'tf_kind']);
    for (const c of cookies) {
      expect(c.options.httpOnly).toBe(true);
      expect(c.options.sameSite).toBe('lax');
      expect(c.options.path).toBe('/tezfix');
      expect(c.options.secure).toBe(false);
    }
    const [at, rt, kind] = cookies;
    expect(at.value).toBe(tokens.accessToken);
    expect(at.options.expires?.toISOString()).toBe(tokens.accessExpiresAt);
    expect(rt.value).toBe(tokens.refreshToken);
    expect(rt.options.expires?.toISOString()).toBe(tokens.refreshExpiresAt);
    expect(kind.value).toBe('admin');
    expect(kind.options.expires?.toISOString()).toBe(tokens.refreshExpiresAt);
  });

  it('marks cookies Secure when asked (production)', () => {
    for (const c of sessionCookies(makeTokens(NOW), 'company', true)) expect(c.options.secure).toBe(true);
    expect(sessionCookies(makeTokens(NOW), 'company', true)[2].value).toBe('company');
  });

  it('clears all three session cookies on the same path', () => {
    const cleared = clearedSessionCookies(true);
    expect(cleared.map((c) => c.name)).toEqual(['tf_at', 'tf_rt', 'tf_kind']);
    for (const c of cleared) {
      expect(c.value).toBe('');
      expect(c.options.path).toBe('/tezfix');
      expect(c.options.maxAge).toBe(0);
      expect(c.options.expires?.getTime()).toBe(0);
    }
  });

  it('keeps the locale cookie readable by the browser but the device cookie httpOnly', () => {
    const l = localeCookie('ru', false);
    expect(l.name).toBe(LOCALE_COOKIE);
    expect(l.value).toBe('ru');
    expect(l.options.httpOnly).toBe(false);
    expect(l.options.path).toBe('/tezfix');
    const d = deviceCookie('web-abcdef123', false);
    expect(d.name).toBe(DEVICE_COOKIE);
    expect(d.options.httpOnly).toBe(true);
    expect(d.options.maxAge).toBeGreaterThan(300 * 86_400);
  });

  it('generates device ids accepted by the API (8..128 chars)', () => {
    const id = newDeviceId();
    expect(isValidDeviceId(id)).toBe(true);
    expect(id.length).toBeGreaterThanOrEqual(8);
    expect(id.length).toBeLessThanOrEqual(128);
    expect(isValidDeviceId('short')).toBe(false);
    expect(isValidDeviceId('has spaces in it')).toBe(false);
    expect(isValidDeviceId(undefined)).toBe(false);
  });
});

describe('JWT expiry', () => {
  it('reads exp from the payload (base64url)', () => {
    expect(jwtExpiryMs(makeJwt(1_800_000_000))).toBe(1_800_000_000_000);
    // payload with characters that need base64url (- and _)
    expect(jwtExpiryMs(makeJwt(1_800_000_000, { name: 'Ələsgər ~~~ ???' }))).toBe(1_800_000_000_000);
  });

  it('returns null for malformed tokens', () => {
    expect(jwtExpiryMs(undefined)).toBeNull();
    expect(jwtExpiryMs('')).toBeNull();
    expect(jwtExpiryMs('a.b')).toBeNull();
    expect(jwtExpiryMs('a.!!!.c')).toBeNull();
    expect(jwtExpiryMs(`x.${Buffer.from('{"sub":"1"}').toString('base64url')}.y`)).toBeNull();
  });

  it('treats tokens expiring inside the skew window as stale', () => {
    const exp = NOW / 1000 + ACCESS_REFRESH_SKEW_MS / 1000;
    expect(isAccessTokenFresh(makeJwt(exp), NOW)).toBe(false); // exactly at the boundary
    expect(isAccessTokenFresh(makeJwt(exp + 1), NOW)).toBe(true);
    expect(isAccessTokenFresh(makeJwt(NOW / 1000 - 10), NOW)).toBe(false);
  });
});

describe('sessionState', () => {
  const fresh = makeJwt(NOW / 1000 + 600);
  const stale = makeJwt(NOW / 1000 - 1);

  it('is active with a fresh access token and a known kind', () => {
    expect(sessionState({ accessToken: fresh, refreshToken: 'r'.repeat(20), kind: 'admin' }, NOW)).toEqual({
      status: 'active',
      kind: 'admin',
      accessToken: fresh,
    });
  });

  it('needs a refresh when the access token is missing or stale but a refresh token exists', () => {
    expect(sessionState({ refreshToken: 'rt-1234567890', kind: 'company' }, NOW)).toEqual({
      status: 'refresh',
      kind: 'company',
      refreshToken: 'rt-1234567890',
    });
    expect(
      sessionState({ accessToken: stale, refreshToken: 'rt-1234567890', kind: 'admin' }, NOW).status,
    ).toBe('refresh');
  });

  it('has no session without a kind or without any token', () => {
    expect(sessionState({ accessToken: fresh, refreshToken: 'rt-1234567890' }, NOW).status).toBe('none');
    expect(sessionState({ accessToken: fresh, kind: 'root' }, NOW).status).toBe('none');
    expect(sessionState({ accessToken: stale, kind: 'admin' }, NOW).status).toBe('none');
    expect(sessionState({}, NOW).status).toBe('none');
  });
});

describe('paths', () => {
  it('classifies panel areas', () => {
    expect(panelArea('/admin')).toBe('admin');
    expect(panelArea('/admin/orders/1')).toBe('admin');
    expect(panelArea('/administrator')).toBe('public');
    expect(panelArea('/company')).toBe('company');
    expect(panelArea('/company/abc/dispatch')).toBe('company');
    expect(panelArea('/bff/realtime-ticket')).toBe('bff');
    expect(panelArea('/join/abcdefghijk')).toBe('public');
    expect(panelArea('/')).toBe('public');
  });

  it('knows the login pages', () => {
    expect(isLoginPath('/admin/login')).toBe(true);
    expect(isLoginPath('/company/login')).toBe(true);
    expect(isLoginPath('/admin')).toBe(false);
    expect(loginPathFor('admin')).toBe('/admin/login');
    expect(loginPathFor('company')).toBe('/company/login');
  });

  it('accepts only same-area relative next paths (no open redirects)', () => {
    expect(safeNextPath('/admin/orders?status=SEARCHING', 'admin')).toBe('/admin/orders?status=SEARCHING');
    expect(safeNextPath(undefined, 'admin')).toBe('/admin');
    expect(safeNextPath('https://evil.example/admin', 'admin')).toBe('/admin');
    expect(safeNextPath('//evil.example/admin', 'admin')).toBe('/admin');
    expect(safeNextPath('/\\evil.example', 'admin')).toBe('/admin');
    expect(safeNextPath('/company/x', 'admin')).toBe('/admin');
    expect(safeNextPath('/admin/login', 'admin')).toBe('/admin');
    expect(safeNextPath('/company/abc/orders', 'company')).toBe('/company/abc/orders');
    expect(safeNextPath('/admin', 'company')).toBe('/company');
  });
});
