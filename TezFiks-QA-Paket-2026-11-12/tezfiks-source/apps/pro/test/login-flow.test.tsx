import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import path from 'node:path';
import { installFakeApi, me, route, TOKENS } from './helpers';

const APP_DIR = path.join(__dirname, '..', 'src', 'app');

describe('pro login screen', () => {
  it('shows the TezFiks Usta tagline (not the customer slogan) in every language', async () => {
    installFakeApi([]);
    await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(screen.getByTestId('phone-screen')).toBeTruthy());
    expect(screen.getByText('Yaxınlıqdakı sifarişlər — öz qrafikinizlə')).toBeTruthy();
    expect(screen.queryByText('Lazım olan anda usta — ev və avto üçün')).toBeNull();

    await fireEvent.press(screen.getByTestId('language-picker-en'));
    await waitFor(() => expect(screen.getByText('Jobs near you — on your own schedule')).toBeTruthy());
    expect(screen.queryByText('A handyman when you need one — for home and car')).toBeNull();

    await fireEvent.press(screen.getByTestId('language-picker-ru'));
    await waitFor(() => expect(screen.getByText('Заказы рядом — в удобное вам время')).toBeTruthy());
    expect(screen.queryByText('Мастер, когда он нужен — для дома и авто')).toBeNull();

    await fireEvent.press(screen.getByTestId('language-picker-az'));
    await waitFor(() => expect(screen.getByText('Yaxınlıqdakı sifarişlər — öz qrafikinizlə')).toBeTruthy());
  });
});

describe('pro login flow (router level)', () => {
  it('signed out → phone → OTP → profile → "Usta kimi qoşulun"', async () => {
    let current = me({ profileComplete: false, firstName: null, lastName: null });
    const calls = installFakeApi([
      route('POST', '/auth/otp/request', () => ({
        status: 200,
        body: { challengeId: 'ch9', phone: '+994551112233', expiresAt: '2026-10-25T10:05:00.000Z', resendAfterSec: 60, channel: 'console', devCode: '654321' },
      })),
      route('POST', '/auth/otp/verify', () => ({ status: 200, body: { tokens: TOKENS, me: current, isNewUser: true } })),
      route('PATCH', '/me', (c) => {
        current = { ...current, ...(c.body as object), profileComplete: true };
        return { status: 200, body: current };
      }),
      route('POST', '/me/devices', () => ({ status: 200, body: { ok: true } })),
    ]);

    const r = await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(screen.getByTestId('phone-screen')).toBeTruthy());
    expect(screen.getByText('TezFiks Usta')).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId('phone-input'), '+994 55 111 22 33');
    await fireEvent.press(screen.getByTestId('phone-continue'));
    await waitFor(() => expect(screen.getByTestId('otp-screen')).toBeTruthy());
    expect(calls[0].body).toEqual({ phone: '+994551112233', app: 'PRO', locale: 'az' });

    await fireEvent.changeText(screen.getByTestId('otp-input'), '654321');
    await waitFor(() => expect(screen.getByTestId('profile-screen')).toBeTruthy());
    expect(screen.getByText('Adınız və şəkliniz müştərilərə görünəcək')).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId('profile-first-name'), 'Elvin');
    await fireEvent.changeText(screen.getByTestId('profile-last-name'), 'Məmmədov');
    await fireEvent.press(screen.getByTestId('profile-save'));
    await waitFor(() => expect(screen.getByTestId('onboarding-screen')).toBeTruthy());
    expect(r.getPathname()).toBe('/onboarding');
    expect(screen.getByText('Usta kimi qoşulun')).toBeTruthy();
    await waitFor(() => expect(calls.find((c) => c.path === '/me/devices')?.body).toMatchObject({ app: 'PRO' }));
  });
});
