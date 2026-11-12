import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import path from 'node:path';
import { installFakeApi, me, route, secureStore, TOKENS } from './helpers';

const APP_DIR = path.join(__dirname, '..', 'src', 'app');

describe('customer login flow (router level)', () => {
  it('signed out → phone → OTP → profile → account type → logout back to phone', async () => {
    let current = me({ profileComplete: false, firstName: null, lastName: null });
    const calls = installFakeApi([
      route('POST', '/auth/otp/request', () => ({
        status: 200,
        body: { challengeId: 'ch1', phone: '+994501234567', expiresAt: '2026-10-25T10:05:00.000Z', resendAfterSec: 60, channel: 'console', devCode: '123456' },
      })),
      route('POST', '/auth/otp/verify', () => ({ status: 200, body: { tokens: TOKENS, me: current, isNewUser: true } })),
      route('PATCH', '/me', (c) => {
        current = { ...current, ...(c.body as object), profileComplete: true };
        return { status: 200, body: current };
      }),
      route('POST', '/me/devices', () => ({ status: 200, body: { ok: true } })),
      route('POST', '/auth/logout', () => ({ status: 200, body: { ok: true } })),
    ]);

    const r = await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(screen.getByTestId('phone-screen')).toBeTruthy());
    expect(r.getPathname()).toBe('/phone');
    expect(screen.getByText('Telefon nömrəsi ilə daxil olun')).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId('phone-input'), '050 123 45 67');
    await fireEvent.press(screen.getByTestId('phone-continue'));
    await waitFor(() => expect(screen.getByTestId('otp-screen')).toBeTruthy());
    expect(r.getPathname()).toBe('/otp');
    expect(screen.getByText('Test rejimi: kodunuz 123456')).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId('otp-input'), '123456');
    await waitFor(() => expect(screen.getByTestId('profile-screen')).toBeTruthy());
    expect(r.getPathname()).toBe('/profile-setup');
    expect(secureStore().get('tf.refreshToken')).toBe('refresh-1');
    expect(calls.find((c) => c.path === '/auth/otp/verify')?.body).toMatchObject({ challengeId: 'ch1', code: '123456', app: 'CUSTOMER' });

    await fireEvent.changeText(screen.getByTestId('profile-first-name'), 'Aysel');
    await fireEvent.changeText(screen.getByTestId('profile-last-name'), 'Qasımova');
    await fireEvent.press(screen.getByTestId('profile-save'));
    await waitFor(() => expect(screen.getByTestId('account-type-screen')).toBeTruthy());
    expect(r.getPathname()).toBe('/account-type');
    expect(screen.getByText('Hesab tipini seçin')).toBeTruthy();
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ firstName: 'Aysel', lastName: 'Qasımova' });

    await waitFor(() => expect(calls.some((c) => c.path === '/me/devices')).toBe(true));
    expect(calls.find((c) => c.path === '/me/devices')?.body).toMatchObject({ app: 'CUSTOMER', platform: 'android', pushToken: null });

    await fireEvent.press(screen.getByTestId('account-type-logout'));
    await waitFor(() => expect(screen.getByTestId('phone-screen')).toBeTruthy());
    expect(secureStore().has('tf.refreshToken')).toBe(false);
    expect(calls.some((c) => c.path === '/auth/logout')).toBe(true);
  });
});
