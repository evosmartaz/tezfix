import { beforeEach, describe, expect, it } from 'vitest';
import { expectRedirect, resetServerMocks, state } from './server-mocks';
import {
  adminLoginAction,
  companyOtpRequestAction,
  companyOtpVerifyAction,
  logoutAction,
  setLocaleAction,
} from '@/lib/actions/auth';
import { adminFixture, apiError, IDS, makeJwt, makeTokens, meFixture, membership, mockApi } from './helpers';

const freshToken = () => makeJwt(Math.floor(Date.now() / 1000) + 600);

describe('adminLoginAction', () => {
  beforeEach(() => resetServerMocks());

  it('logs in, stores the tokens in httpOnly cookies and redirects to /admin', async () => {
    const tokens = makeTokens();
    const { calls } = mockApi({
      'POST /auth/admin/login': () => ({ status: 200, body: { tokens, admin: adminFixture } }),
    });
    const location = await expectRedirect(() =>
      adminLoginAction({ email: 'admin@tezfiks.az', password: 'secret-pass' }),
    );
    expect(location).toBe('/admin');
    expect(calls[0].body).toEqual({ email: 'admin@tezfiks.az', password: 'secret-pass' });
    expect(state.jar!.values.get('tf_at')?.value).toBe(tokens.accessToken);
    expect(state.jar!.values.get('tf_rt')?.value).toBe(tokens.refreshToken);
    expect(state.jar!.values.get('tf_kind')?.value).toBe('admin');
  });

  it('revokes the session this browser already holds (company panel) before storing the admin session', async () => {
    const oldAt = freshToken();
    resetServerMocks({ tf_at: oldAt, tf_rt: 'rt-old-company-123456', tf_kind: 'company' });
    const tokens = makeTokens(Date.now(), 'new');
    const { calls } = mockApi({
      'POST /auth/admin/login': () => ({ status: 200, body: { tokens, admin: adminFixture } }),
      'POST /auth/logout': () => ({ status: 200, body: { ok: true } }),
    });
    expect(await expectRedirect(() => adminLoginAction({ email: 'admin@tezfiks.az', password: 'secret-pass' }))).toBe(
      '/admin',
    );
    const logout = calls.find((c) => c.path === '/auth/logout');
    expect(logout?.body).toEqual({ refreshToken: 'rt-old-company-123456' });
    expect(logout?.headers.authorization).toBe(`Bearer ${oldAt}`);
    expect(state.jar!.values.get('tf_rt')?.value).toBe(tokens.refreshToken);
    expect(state.jar!.values.get('tf_kind')?.value).toBe('admin');
  });

  it('keeps the existing session when the new login fails', async () => {
    resetServerMocks({ tf_at: freshToken(), tf_rt: 'rt-old-company-123456', tf_kind: 'company' });
    const { calls } = mockApi({
      'POST /auth/admin/login': () => apiError(401, 'INVALID_CREDENTIALS'),
      'POST /auth/logout': () => ({ status: 200, body: { ok: true } }),
    });
    const result = await adminLoginAction({ email: 'admin@tezfiks.az', password: 'wrong-pass' });
    expect(result.ok).toBe(false);
    expect(calls.some((c) => c.path === '/auth/logout')).toBe(false);
    expect(state.jar!.values.get('tf_rt')?.value).toBe('rt-old-company-123456');
  });

  it('still logs in when revoking the previous session fails', async () => {
    resetServerMocks({ tf_at: freshToken(), tf_rt: 'rt-old-admin-1234567', tf_kind: 'admin' });
    const tokens = makeTokens(Date.now(), 'again');
    mockApi({
      'POST /auth/admin/login': () => ({ status: 200, body: { tokens, admin: adminFixture } }),
      'POST /auth/logout': () => apiError(401, 'SESSION_REVOKED'),
    });
    expect(await expectRedirect(() => adminLoginAction({ email: 'admin@tezfiks.az', password: 'secret-pass' }))).toBe(
      '/admin',
    );
    expect(state.jar!.values.get('tf_rt')?.value).toBe(tokens.refreshToken);
  });

  it('honours a safe next path and ignores an external one', async () => {
    mockApi({
      'POST /auth/admin/login': () => ({ status: 200, body: { tokens: makeTokens(), admin: adminFixture } }),
    });
    expect(
      await expectRedirect(() =>
        adminLoginAction({ email: 'admin@tezfiks.az', password: 'x', next: '/admin/handymen' }),
      ),
    ).toBe('/admin/handymen');
    expect(
      await expectRedirect(() =>
        adminLoginAction({ email: 'admin@tezfiks.az', password: 'x', next: 'https://evil.example' }),
      ),
    ).toBe('/admin');
  });

  it('returns the localized API error for wrong credentials and sets no cookie', async () => {
    resetServerMocks({ locale: 'en' });
    const { calls } = mockApi({
      'POST /auth/admin/login': () => apiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect'),
    });
    const result = await adminLoginAction({ email: 'admin@tezfiks.az', password: 'wrong' });
    expect(result).toMatchObject({
      ok: false,
      code: 'INVALID_CREDENTIALS',
      message: 'Email or password is incorrect',
    });
    expect(calls[0].headers['accept-language']).toBe('en');
    expect(state.jar!.values.has('tf_at')).toBe(false);
  });

  it('rejects malformed input without calling the API', async () => {
    const { calls } = mockApi({});
    const result = await adminLoginAction({ email: 'not-an-email', password: '' });
    expect(result).toMatchObject({ ok: false, code: 'VALIDATION_FAILED', message: 'Məlumatları yoxlayın' });
    expect(calls).toHaveLength(0);
  });

  it('reports an unreachable API with the translated NETWORK message', async () => {
    mockApi({});
    globalThis.fetch = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    const result = await adminLoginAction({ email: 'admin@tezfiks.az', password: 'x' });
    expect(result).toMatchObject({ ok: false, code: 'NETWORK', message: 'Serverə qoşulmaq mümkün olmadı' });
  });
});

describe('company OTP login', () => {
  beforeEach(() => resetServerMocks({ locale: 'ru' }));

  const challenge = {
    challengeId: IDS.challenge,
    phone: '+994501234567',
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    resendAfterSec: 60,
    channel: 'whatsapp',
    devCode: '123456',
  };

  it('requests a code for the PANEL app in the current language and returns the dev code hint', async () => {
    const { calls } = mockApi({ 'POST /auth/otp/request': () => ({ status: 200, body: challenge }) });
    const result = await companyOtpRequestAction({ phone: '050 123 45 67' });
    expect(calls[0].body).toEqual({ phone: '050 123 45 67', app: 'PANEL', locale: 'ru' });
    expect(result).toEqual({
      ok: true,
      data: {
        challengeId: IDS.challenge,
        phone: '+994501234567',
        expiresAt: challenge.expiresAt,
        resendAfterSec: 60,
        devCode: '123456',
      },
    });
  });

  it('passes OTP cooldown errors through', async () => {
    mockApi({ 'POST /auth/otp/request': () => apiError(429, 'OTP_COOLDOWN', 'Подождите') });
    expect(await companyOtpRequestAction({ phone: '0501234567' })).toMatchObject({
      ok: false,
      code: 'OTP_COOLDOWN',
      message: 'Подождите',
    });
  });

  it('revokes an admin session held by this browser when a company user logs in', async () => {
    const oldAt = freshToken();
    resetServerMocks({ tf_at: oldAt, tf_rt: 'rt-old-admin-1234567', tf_kind: 'admin' });
    const tokens = makeTokens(Date.now(), 'co');
    const me = meFixture([membership(IDS.companyA, 'MANAGER')]);
    const { calls } = mockApi({
      'POST /auth/otp/verify': () => ({ status: 200, body: { tokens, me, isNewUser: false } }),
      'POST /auth/logout': () => ({ status: 200, body: { ok: true } }),
    });
    expect(await expectRedirect(() => companyOtpVerifyAction({ challengeId: IDS.challenge, code: '123456' }))).toBe(
      `/company/${IDS.companyA}`,
    );
    const logout = calls.find((c) => c.path === '/auth/logout');
    expect(logout?.body).toEqual({ refreshToken: 'rt-old-admin-1234567' });
    expect(logout?.headers.authorization).toBe(`Bearer ${oldAt}`);
    expect(state.jar!.values.get('tf_kind')?.value).toBe('company');
    expect(state.jar!.values.get('tf_rt')?.value).toBe(tokens.refreshToken);
  });

  it('verifies with a persistent device id and goes straight to the only managed company', async () => {
    const tokens = makeTokens();
    const me = meFixture([membership(IDS.companyA, 'MANAGER'), membership(IDS.companyB, 'WORKER')]);
    const { calls } = mockApi({
      'POST /auth/otp/verify': () => ({ status: 200, body: { tokens, me, isNewUser: false } }),
    });
    const location = await expectRedirect(() =>
      companyOtpVerifyAction({ challengeId: IDS.challenge, code: '123456' }),
    );
    expect(location).toBe(`/company/${IDS.companyA}`);
    const deviceId = state.jar!.values.get('tf_did')?.value;
    expect(deviceId).toMatch(/^web-/);
    expect(calls[0].body).toEqual({ challengeId: IDS.challenge, code: '123456', deviceId, app: 'PANEL' });
    expect(state.jar!.values.get('tf_kind')?.value).toBe('company');
    expect(state.jar!.values.get('tf_at')?.value).toBe(tokens.accessToken);
  });

  it('goes to the chooser with several (or zero) managed companies', async () => {
    const two = meFixture([membership(IDS.companyA, 'MANAGER'), membership(IDS.companyB, 'MANAGER')]);
    mockApi({
      'POST /auth/otp/verify': () => ({
        status: 200,
        body: { tokens: makeTokens(), me: two, isNewUser: false },
      }),
    });
    expect(
      await expectRedirect(() => companyOtpVerifyAction({ challengeId: IDS.challenge, code: '123456' })),
    ).toBe('/company');
    mockApi({
      'POST /auth/otp/verify': () => ({
        status: 200,
        body: { tokens: makeTokens(), me: meFixture([]), isNewUser: true },
      }),
    });
    expect(
      await expectRedirect(() => companyOtpVerifyAction({ challengeId: IDS.challenge, code: '123456' })),
    ).toBe('/company');
  });

  it('returns to the requested company page after login', async () => {
    const me = meFixture([membership(IDS.companyA, 'MANAGER')]);
    mockApi({
      'POST /auth/otp/verify': () => ({ status: 200, body: { tokens: makeTokens(), me, isNewUser: false } }),
    });
    const next = `/company/${IDS.companyA}/dispatch`;
    expect(
      await expectRedirect(() =>
        companyOtpVerifyAction({ challengeId: IDS.challenge, code: '123456', next }),
      ),
    ).toBe(next);
  });

  it('reports a wrong code and keeps the user logged out', async () => {
    mockApi({ 'POST /auth/otp/verify': () => apiError(400, 'OTP_INVALID', 'Неверный код') });
    expect(await companyOtpVerifyAction({ challengeId: IDS.challenge, code: '000000' })).toMatchObject({
      ok: false,
      code: 'OTP_INVALID',
      message: 'Неверный код',
    });
    expect(state.jar!.values.has('tf_at')).toBe(false);
  });

  it('rejects a code that is not 6 digits without calling the API', async () => {
    const { calls } = mockApi({});
    expect(await companyOtpVerifyAction({ challengeId: IDS.challenge, code: '12a' })).toMatchObject({
      ok: false,
      code: 'VALIDATION_FAILED',
      message: 'Неверный код',
    });
    expect(calls).toHaveLength(0);
  });
});

describe('logoutAction', () => {
  it('revokes the session at the API, clears the cookies and goes to the matching login', async () => {
    const at = freshToken();
    resetServerMocks({ tf_at: at, tf_rt: 'rt-logout-123456', tf_kind: 'company' });
    const { calls } = mockApi({ 'POST /auth/logout': () => ({ status: 200, body: { ok: true } }) });
    expect(await expectRedirect(() => logoutAction())).toBe('/company/login');
    expect(calls[0].body).toEqual({ refreshToken: 'rt-logout-123456' });
    expect(calls[0].headers.authorization).toBe(`Bearer ${at}`);
    for (const name of ['tf_at', 'tf_rt', 'tf_kind']) expect(state.jar!.values.get(name)?.value).toBe('');
  });

  it('still clears the cookies when the API call fails', async () => {
    resetServerMocks({ tf_at: freshToken(), tf_rt: 'rt-logout-123456', tf_kind: 'admin' });
    mockApi({ 'POST /auth/logout': () => apiError(401, 'SESSION_REVOKED') });
    expect(await expectRedirect(() => logoutAction())).toBe('/admin/login');
    expect(state.jar!.values.get('tf_rt')?.value).toBe('');
  });
});

describe('setLocaleAction', () => {
  beforeEach(() => resetServerMocks());

  it('stores the language cookie and revalidates the layout', async () => {
    expect(await setLocaleAction('en')).toEqual({ ok: true, data: undefined });
    expect(state.jar!.values.get('locale')).toMatchObject({
      value: 'en',
      options: { path: '/tezfix', httpOnly: false },
    });
    expect(state.revalidated).toEqual(['/']);
  });

  it('rejects unknown languages', async () => {
    expect(await setLocaleAction('de' as never)).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(state.jar!.values.has('locale')).toBe(false);
  });
});
