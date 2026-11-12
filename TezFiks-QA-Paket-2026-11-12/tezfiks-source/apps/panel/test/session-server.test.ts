import { beforeEach, describe, expect, it } from 'vitest';
import { expectNotFound, expectRedirect, resetServerMocks, state } from './server-mocks';
import {
  clearSessionCookies,
  ensureDeviceId,
  getAdmin,
  getSession,
  managedCompanies,
  requireAdmin,
  requireCompanyUser,
  requireManager,
  SessionRefreshUnavailableError,
  setSessionCookies,
} from '@/lib/session/server';
import { adminFixture, apiError, IDS, makeJwt, makeTokens, meFixture, membership, mockApi } from './helpers';

const freshToken = () => makeJwt(Math.floor(Date.now() / 1000) + 600);

describe('getSession', () => {
  beforeEach(() => resetServerMocks());

  it('returns null without cookies', async () => {
    expect(await getSession()).toBeNull();
  });

  it('returns kind and access token for an active session', async () => {
    const at = freshToken();
    resetServerMocks({ tf_at: at, tf_rt: 'rt-1234567890', tf_kind: 'company' });
    expect(await getSession()).toEqual({ kind: 'company', accessToken: at });
  });

  it('ignores an expired access token (the proxy refreshes before rendering)', async () => {
    resetServerMocks({
      tf_at: makeJwt(Math.floor(Date.now() / 1000) - 1),
      tf_rt: 'rt-1234567890',
      tf_kind: 'admin',
    });
    expect(await getSession()).toBeNull();
  });
});

describe('requireAdmin', () => {
  beforeEach(() => resetServerMocks());

  it('redirects to the admin login without a session', async () => {
    mockApi({});
    expect(await expectRedirect(() => requireAdmin())).toBe('/admin/login?expired=1');
  });

  it('redirects a company session to the admin login', async () => {
    resetServerMocks({ tf_at: freshToken(), tf_kind: 'company' });
    const { calls } = mockApi({});
    expect(await expectRedirect(() => requireAdmin())).toBe('/admin/login?expired=1');
    expect(calls).toHaveLength(0);
  });

  it('redirects when the API rejects the token (revoked session)', async () => {
    resetServerMocks({ tf_at: freshToken(), tf_kind: 'admin' });
    mockApi({ 'GET /admin/me': () => apiError(401, 'SESSION_REVOKED') });
    expect(await expectRedirect(() => requireAdmin())).toBe('/admin/login?expired=1');
  });

  it('returns the admin and an authenticated API client, sending the bearer token and locale', async () => {
    const at = freshToken();
    resetServerMocks({ tf_at: at, tf_kind: 'admin', locale: 'ru' }, { 'x-forwarded-for': '10.0.0.7' });
    const { calls } = mockApi({ 'GET /admin/me': () => ({ status: 200, body: adminFixture }) });
    const ctx = await requireAdmin();
    expect(ctx.admin).toEqual(adminFixture);
    expect(ctx.locale).toBe('ru');
    expect(calls[0].headers.authorization).toBe(`Bearer ${at}`);
    expect(calls[0].headers['accept-language']).toBe('ru');
    expect(calls[0].headers['x-forwarded-for']).toBe('10.0.0.7');
  });

  it('propagates API outages (error page) instead of logging the admin out', async () => {
    resetServerMocks({ tf_at: freshToken(), tf_kind: 'admin' });
    mockApi({ 'GET /admin/me': () => apiError(500, 'INTERNAL') });
    await expect(requireAdmin()).rejects.toMatchObject({ code: 'INTERNAL' });
  });

  it('shows the error page (not "session expired") when the proxy could not refresh because the API is down', async () => {
    resetServerMocks({
      tf_at: makeJwt(Math.floor(Date.now() / 1000) - 1),
      tf_rt: 'rt-1234567890',
      tf_kind: 'admin',
    });
    const { calls } = mockApi({});
    await expect(requireAdmin()).rejects.toBeInstanceOf(SessionRefreshUnavailableError);
    await expect(requireAdmin()).rejects.toMatchObject({ code: 'NETWORK' });
    expect(calls).toHaveLength(0);
  });

  it('still redirects to the admin login when the pending refresh belongs to a company session', async () => {
    resetServerMocks({
      tf_at: makeJwt(Math.floor(Date.now() / 1000) - 1),
      tf_rt: 'rt-1234567890',
      tf_kind: 'company',
    });
    mockApi({});
    expect(await expectRedirect(() => requireAdmin())).toBe('/admin/login?expired=1');
  });

  it('getAdmin returns null instead of redirecting', async () => {
    mockApi({});
    expect(await getAdmin()).toBeNull();
  });
});

describe('requireManager', () => {
  beforeEach(() => resetServerMocks({ tf_at: freshToken(), tf_kind: 'company' }));

  it('redirects to the company login without a session', async () => {
    resetServerMocks();
    mockApi({});
    expect(await expectRedirect(() => requireManager(IDS.companyA))).toBe('/company/login?expired=1');
  });

  it('allows a MANAGER of the company', async () => {
    const me = meFixture([
      membership(IDS.companyA, 'MANAGER'),
      membership(IDS.companyB, 'WORKER', 'Başqa MMC'),
    ]);
    mockApi({ 'GET /me': () => ({ status: 200, body: me }) });
    const ctx = await requireManager(IDS.companyA);
    expect(ctx.company.companyId).toBe(IDS.companyA);
    expect(ctx.me.lastName).toBe('Məmmədov');
  });

  it('404s for a company where the user is only a WORKER', async () => {
    const me = meFixture([membership(IDS.companyA, 'MANAGER'), membership(IDS.companyB, 'WORKER')]);
    mockApi({ 'GET /me': () => ({ status: 200, body: me }) });
    await expectNotFound(() => requireManager(IDS.companyB));
  });

  it("404s for another company's id", async () => {
    mockApi({ 'GET /me': () => ({ status: 200, body: meFixture([membership(IDS.companyA, 'MANAGER')]) }) });
    await expectNotFound(() => requireManager('99999999-9999-4999-8999-999999999999'));
  });

  it('rejects an admin session in the company panel', async () => {
    resetServerMocks({ tf_at: freshToken(), tf_kind: 'admin' });
    mockApi({});
    expect(await expectRedirect(() => requireCompanyUser())).toBe('/company/login?expired=1');
  });

  it('shows the error page when a company session could not be refreshed because the API is down', async () => {
    resetServerMocks({
      tf_at: makeJwt(Math.floor(Date.now() / 1000) - 1),
      tf_rt: 'rt-1234567890',
      tf_kind: 'company',
    });
    mockApi({});
    await expect(requireManager(IDS.companyA)).rejects.toBeInstanceOf(SessionRefreshUnavailableError);
  });

  it('managedCompanies keeps MANAGER memberships only', () => {
    const me = meFixture([membership(IDS.companyA, 'WORKER'), membership(IDS.companyB, 'MANAGER')]);
    expect(managedCompanies(me).map((c) => c.companyId)).toEqual([IDS.companyB]);
  });
});

describe('cookie writers', () => {
  beforeEach(() => resetServerMocks());

  it('setSessionCookies / clearSessionCookies write and expire the three cookies', async () => {
    const tokens = makeTokens();
    await setSessionCookies(tokens, 'admin');
    expect(state.jar!.values.get('tf_at')?.value).toBe(tokens.accessToken);
    expect(state.jar!.values.get('tf_rt')?.value).toBe(tokens.refreshToken);
    expect(state.jar!.values.get('tf_kind')?.value).toBe('admin');
    expect(state.jar!.values.get('tf_at')?.options).toMatchObject({
      httpOnly: true,
      path: '/tezfix',
      sameSite: 'lax',
    });
    await clearSessionCookies();
    for (const name of ['tf_at', 'tf_rt', 'tf_kind']) {
      expect(state.jar!.values.get(name)?.value).toBe('');
      expect(state.jar!.values.get(name)?.options).toMatchObject({ maxAge: 0, path: '/tezfix' });
    }
  });

  it('ensureDeviceId creates the device cookie once and then reuses it', async () => {
    const id = await ensureDeviceId();
    expect(id).toMatch(/^web-/);
    expect(state.jar!.values.get('tf_did')?.value).toBe(id);
    expect(await ensureDeviceId()).toBe(id);
  });
});
