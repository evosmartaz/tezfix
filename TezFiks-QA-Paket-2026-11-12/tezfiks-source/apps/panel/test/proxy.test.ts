import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { decideProxy } from '@/lib/session/proxy-logic';
import type { Refresher, RefreshOutcome } from '@/lib/session/refresher';
import { proxy, stripBasePath } from '@/proxy';
import { apiError, makeJwt, makeTokens, mockApi } from './helpers';

const NOW = Date.parse('2026-10-25T10:00:00.000Z');
const fresh = makeJwt(NOW / 1000 + 600);
const stale = makeJwt(NOW / 1000 - 5);

function fakeRefresher(outcome: RefreshOutcome): Refresher & { refresh: ReturnType<typeof vi.fn> } {
  return { refresh: vi.fn(async () => outcome), size: () => 0 };
}

function input(pathname: string, cookies: Record<string, string>, search = '') {
  return { pathname, pathWithSearch: pathname + search, cookies, nowMs: NOW, secure: false };
}

describe('decideProxy', () => {
  it('does nothing for public pages', async () => {
    const r = fakeRefresher({ ok: false, code: 'X' });
    for (const p of ['/', '/join/abcdefghijkl', '/favicon.svg']) {
      expect(await decideProxy(input(p, { tf_rt: 'rt-1234567890', tf_kind: 'admin' }), r)).toEqual({
        type: 'next',
        setCookies: [],
        requestCookies: {},
      });
    }
    expect(r.refresh).not.toHaveBeenCalled();
  });

  it('lets an active session through without refreshing', async () => {
    const r = fakeRefresher({ ok: false, code: 'X' });
    const d = await decideProxy(
      input('/admin/orders', { tf_at: fresh, tf_rt: 'rt-1234567890', tf_kind: 'admin' }),
      r,
    );
    expect(d.type).toBe('next');
    expect(r.refresh).not.toHaveBeenCalled();
  });

  it('refreshes an expired access token and forwards the new cookies to the page and the browser', async () => {
    const tokens = makeTokens(NOW, 'new');
    const r = fakeRefresher({ ok: true, tokens });
    const d = await decideProxy(
      input('/company/abc/dispatch', { tf_at: stale, tf_rt: 'rt-old-1234567', tf_kind: 'company' }),
      r,
    );
    expect(r.refresh).toHaveBeenCalledWith('rt-old-1234567');
    expect(d.type).toBe('next');
    if (d.type !== 'next') throw new Error('unreachable');
    expect(d.requestCookies).toEqual({
      tf_at: tokens.accessToken,
      tf_rt: tokens.refreshToken,
      tf_kind: 'company',
    });
    expect(d.setCookies.map((c) => [c.name, c.value])).toEqual([
      ['tf_at', tokens.accessToken],
      ['tf_rt', tokens.refreshToken],
      ['tf_kind', 'company'],
    ]);
  });

  it('refreshes when the access cookie is missing (expired in the browser)', async () => {
    const r = fakeRefresher({ ok: true, tokens: makeTokens(NOW) });
    const d = await decideProxy(input('/admin', { tf_rt: 'rt-old-1234567', tf_kind: 'admin' }), r);
    expect(r.refresh).toHaveBeenCalledOnce();
    expect(d.type).toBe('next');
  });

  it('clears the session and redirects to the login when the refresh is rejected', async () => {
    const r = fakeRefresher({ ok: false, code: 'REFRESH_INVALID' });
    const d = await decideProxy(
      input('/admin/handymen', { tf_rt: 'rt-old-1234567', tf_kind: 'admin' }, '?tab=pending'),
      r,
    );
    expect(d.type).toBe('redirect');
    if (d.type !== 'redirect') throw new Error('unreachable');
    expect(d.location).toBe(`/admin/login?next=${encodeURIComponent('/admin/handymen?tab=pending')}`);
    expect(d.setCookies.map((c) => [c.name, c.value, c.options.maxAge])).toEqual([
      ['tf_at', '', 0],
      ['tf_rt', '', 0],
      ['tf_kind', '', 0],
    ]);
  });

  it('keeps the refresh cookie when the API is unreachable', async () => {
    const r = fakeRefresher({ ok: false, code: 'NETWORK' });
    const d = await decideProxy(input('/admin', { tf_rt: 'rt-old-1234567', tf_kind: 'admin' }), r);
    expect(d).toEqual({ type: 'next', setCookies: [], requestCookies: {} });
  });

  it('shows the login page with a dead session cleared instead of looping', async () => {
    const r = fakeRefresher({ ok: false, code: 'SESSION_REVOKED' });
    const d = await decideProxy(input('/admin/login', { tf_rt: 'rt-old-1234567', tf_kind: 'admin' }), r);
    expect(d.type).toBe('next');
    if (d.type !== 'next') throw new Error('unreachable');
    expect(d.setCookies).toHaveLength(3);
    expect(d.requestCookies).toEqual({ tf_at: null, tf_rt: null, tf_kind: null });
  });

  it('redirects protected pages without any session to the matching login', async () => {
    const r = fakeRefresher({ ok: false, code: 'X' });
    expect(await decideProxy(input('/admin/orders', {}), r)).toMatchObject({
      type: 'redirect',
      location: '/admin/login?next=%2Fadmin%2Forders',
    });
    expect(await decideProxy(input('/company/abc', {}), r)).toMatchObject({
      type: 'redirect',
      location: '/company/login?next=%2Fcompany%2Fabc',
    });
    expect(await decideProxy(input('/company/login', {}), r)).toMatchObject({ type: 'next' });
  });

  it('answers 401 for BFF handlers without a session', async () => {
    const r = fakeRefresher({ ok: false, code: 'REFRESH_INVALID' });
    expect((await decideProxy(input('/bff/realtime-ticket', {}), r)).type).toBe('unauthorized');
    expect(
      (await decideProxy(input('/bff/realtime-ticket', { tf_rt: 'rt-old-1234567', tf_kind: 'admin' }), r))
        .type,
    ).toBe('unauthorized');
  });
});

describe('proxy (Next.js request/response)', () => {
  it('strips the basePath', () => {
    expect(stripBasePath('/tezfix/admin')).toBe('/admin');
    expect(stripBasePath('/tezfix')).toBe('/');
    expect(stripBasePath('/admin')).toBe('/admin');
  });

  it('refreshes through the API and sets httpOnly cookies on /tezfix plus the forwarded request cookies', async () => {
    const tokens = makeTokens(Date.now(), 'rotated');
    const { calls } = mockApi({ 'POST /auth/refresh': () => ({ status: 200, body: tokens }) });
    const req = new NextRequest('http://panel.test/tezfix/admin/orders', {
      headers: { cookie: 'tf_rt=rt-proxy-test-0001; tf_kind=admin' },
      nextConfig: { basePath: '/tezfix' },
    });
    const res = await proxy(req);
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toEqual({ refreshToken: 'rt-proxy-test-0001' });
    const setCookie = res.headers.getSetCookie().join('\n');
    expect(setCookie).toContain(`tf_at=${tokens.accessToken}`);
    expect(setCookie).toContain(`tf_rt=${tokens.refreshToken}`);
    expect(setCookie).toMatch(/tf_at=[^;]+;.*Path=\/tezfix/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=lax/i);
    // The page rendered for this request sees the new access token.
    expect(res.headers.get('x-middleware-request-cookie') ?? '').toContain(tokens.accessToken);
  });

  it('redirects to the admin login (with basePath) when the refresh token is rejected', async () => {
    mockApi({ 'POST /auth/refresh': () => apiError(401, 'REFRESH_INVALID') });
    const req = new NextRequest('http://panel.test/tezfix/admin/orders?page=2', {
      headers: { cookie: 'tf_rt=rt-proxy-test-0002; tf_kind=admin' },
      nextConfig: { basePath: '/tezfix' },
    });
    const res = await proxy(req);
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get('location') ?? '');
    expect(location.pathname).toBe('/tezfix/admin/login');
    expect(location.searchParams.get('next')).toBe('/admin/orders?page=2');
    expect(res.headers.getSetCookie().join('\n')).toMatch(/tf_rt=;/);
  });
});
