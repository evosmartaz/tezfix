import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import path from 'node:path';
import { installFakeApi, me, route, secureStore } from './helpers';

const APP_DIR = path.join(__dirname, '..', 'src', 'app');

describe('customer offline start (router level)', () => {
  it('keeps the saved session when the API is unreachable and recovers on retry', async () => {
    secureStore().set('tf.refreshToken', 'refresh-old');
    let online = false;
    global.fetch = jest.fn(async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;

    const r = await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(screen.getByTestId('offline-screen')).toBeTruthy());
    expect(r.getPathname()).toBe('/offline');
    expect(secureStore().get('tf.refreshToken')).toBe('refresh-old');
    expect(screen.getByText('Serverə qoşulmaq mümkün olmadı')).toBeTruthy();

    online = true;
    installFakeApi([
      route('POST', '/auth/refresh', () => ({
        status: 200,
        body: { accessToken: 'a2', refreshToken: 'r2', accessExpiresAt: '2026-10-25T10:15:00.000Z', refreshExpiresAt: '2026-11-24T10:00:00.000Z' },
      })),
      route('GET', '/me', () => ({ status: 200, body: me({ customer: { id: 'ca1', type: 'COMPANY', companyName: 'Kontur MMC' } }) })),
      route('POST', '/me/devices', () => ({ status: 200, body: { ok: true } })),
    ]);
    expect(online).toBe(true);
    await fireEvent.press(screen.getByTestId('error-state-retry'));
    await waitFor(() => expect(screen.getByTestId('home-screen')).toBeTruthy());
    expect(r.getPathname()).toBe('/');
  });
});
