import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import path from 'node:path';
import { installFakeApi, me, route, TOKENS } from './helpers';
import { resetApp, routeRe, signedIn, UUID } from './pro-helpers';
import { peekPendingInvite } from '../src/lib/invite';
import { PUBLIC_CONFIG, profileResponse, proProfile } from './fixtures';

const APP_DIR = path.join(__dirname, '..', 'src', 'app');
const TOKEN = 'Inv1te_T0ken-abcdefghijk';

const preview = (over: Record<string, unknown> = {}) => ({
  companyName: 'FixPro MMC',
  role: 'WORKER',
  expiresAt: '2026-11-01T10:00:00.000Z',
  valid: true,
  reason: null,
  ...over,
});

afterEach(() => resetApp());

describe('invite deep link tezfiksusta://join/<token>', () => {
  it('signed out: goes to login, keeps the token through OTP and lands on the join screen, then joins the company', async () => {
    let current = me({ firstName: 'Rauf', lastName: 'Hüseynov' });
    const calls = installFakeApi([
      route('POST', '/auth/otp/request', () => ({
        status: 200,
        body: { challengeId: 'ch1', phone: '+994551112233', expiresAt: '2026-10-25T10:05:00.000Z', resendAfterSec: 60, channel: 'console', devCode: '123456' },
      })),
      route('POST', '/auth/otp/verify', () => ({ status: 200, body: { tokens: TOKENS, me: current, isNewUser: false } })),
      route('GET', '/me', () => ({ status: 200, body: current })),
      route('POST', '/me/devices', () => ({ status: 200, body: { ok: true } })),
      route('GET', '/config/public', () => ({ status: 200, body: PUBLIC_CONFIG })),
      route('GET', `/invites/${TOKEN}`, () => ({ status: 200, body: preview() })),
      route('POST', `/invites/${TOKEN}/accept`, () => {
        current = me({
          firstName: 'Rauf',
          lastName: 'Hüseynov',
          handyman: { id: UUID(1), kind: 'COMPANY_WORKER', status: 'APPROVED', companyId: UUID(9), isOnline: false },
          companies: [{ companyId: UUID(9), companyName: 'FixPro MMC', role: 'WORKER', companyStatus: 'APPROVED' }],
        });
        return { status: 200, body: profileResponse({ profile: proProfile({ kind: 'COMPANY_WORKER', company: { id: UUID(9), name: 'FixPro MMC', finalPriceEntry: 'MANAGER' } }) }) };
      }),
      route('GET', '/pro/profile', () => ({
        status: 200,
        body: profileResponse({ profile: proProfile({ kind: 'COMPANY_WORKER', wallet: null, company: { id: UUID(9), name: 'FixPro MMC', finalPriceEntry: 'MANAGER' } }) }),
      })),
      route('GET', '/pro/stats/today', () => ({ status: 200, body: { date: '2026-10-25', jobs: 0, earnings: 0, fees: 0 } })),
    ]);

    const r = await renderRouter(APP_DIR, { initialUrl: `/join/${TOKEN}` });
    await waitFor(() => expect(screen.getByTestId('phone-screen')).toBeTruthy());
    expect(peekPendingInvite()).toBe(TOKEN);

    await fireEvent.changeText(screen.getByTestId('phone-input'), '55 111 22 33');
    await fireEvent.press(screen.getByTestId('phone-continue'));
    await waitFor(() => expect(screen.getByTestId('otp-screen')).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('otp-input'), '123456');

    await waitFor(() => expect(screen.getByTestId('join-screen')).toBeTruthy());
    expect(r.getPathname()).toBe(`/join/${TOKEN}`);
    expect(peekPendingInvite()).toBeNull();
    await waitFor(() => expect(screen.getByText('FixPro MMC')).toBeTruthy());
    expect(screen.getByText('Rol: Usta')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('join-accept'));
    await waitFor(() => expect(screen.getByTestId('home-screen')).toBeTruthy());
    expect(calls.find((c) => c.method === 'POST' && c.path === `/invites/${TOKEN}/accept`)?.body).toEqual({});
    expect(r.getPathname()).toBe('/');
    await waitFor(() => expect(screen.getByTestId('home-company')).toBeTruthy());
    expect(screen.getByText('Şirkət: FixPro MMC')).toBeTruthy();
  });

  it('a user who is still onboarding stays on the join screen (onboarding gate allows join)', async () => {
    const current = me();
    installFakeApi([...signedIn(() => current), route('GET', `/invites/${TOKEN}`, () => ({ status: 200, body: preview({ role: 'MANAGER' }) }))]);
    const r = await renderRouter(APP_DIR, { initialUrl: `/join/${TOKEN}` });
    await waitFor(() => expect(screen.getByTestId('join-screen')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('Rol: İdarəedici')).toBeTruthy());
    expect(r.getPathname()).toBe(`/join/${TOKEN}`);
  });

  it('shows why an invite cannot be used and offers no join button', async () => {
    const current = me();
    installFakeApi([...signedIn(() => current), route('GET', `/invites/${TOKEN}`, () => ({ status: 200, body: preview({ valid: false, reason: 'EXPIRED' }) }))]);
    await renderRouter(APP_DIR, { initialUrl: `/join/${TOKEN}` });
    await waitFor(() => expect(screen.getByTestId('join-reason')).toBeTruthy());
    expect(screen.getByText('Dəvət linkinin vaxtı bitib. İdarəedicidən yeni link istəyin')).toBeTruthy();
    expect(screen.queryByTestId('join-accept')).toBeNull();
  });

  it('shows the accept error (already a handyman) and stays', async () => {
    const current = me();
    installFakeApi([
      ...signedIn(() => current),
      route('GET', `/invites/${TOKEN}`, () => ({ status: 200, body: preview() })),
      routeRe('POST', /^\/invites\/.+\/accept$/, () => ({ status: 409, body: { error: { code: 'ALREADY_HANDYMAN', message: 'x', details: null } } })),
    ]);
    const r = await renderRouter(APP_DIR, { initialUrl: `/join/${TOKEN}` });
    await waitFor(() => expect(screen.getByTestId('join-accept')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('join-accept'));
    await waitFor(() => expect(r.getPathname()).toBe(`/join/${TOKEN}`));
    await waitFor(() => expect(screen.getByTestId('join-screen')).toBeTruthy());
  });

  it('the invite option on "Usta kimi qoşulun" accepts a pasted link and opens the join screen', async () => {
    const current = me();
    installFakeApi([...signedIn(() => current), route('GET', `/invites/${TOKEN}`, () => ({ status: 200, body: preview() }))]);
    const r = await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(screen.getByTestId('onboarding-screen')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('choice-invite'));
    await fireEvent.changeText(screen.getByTestId('invite-input'), 'abc');
    await fireEvent.press(screen.getByTestId('onboarding-continue'));
    expect(screen.getByText('Dəvət linki düzgün deyil')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('invite-input'), `https://evosmart.az/tezfix/join/${TOKEN}`);
    await fireEvent.press(screen.getByTestId('onboarding-continue'));
    await waitFor(() => expect(screen.getByTestId('join-screen')).toBeTruthy());
    expect(r.getPathname()).toBe(`/join/${TOKEN}`);
  });
});
