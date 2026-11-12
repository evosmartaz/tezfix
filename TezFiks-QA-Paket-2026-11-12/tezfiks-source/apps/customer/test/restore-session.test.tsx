import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import path from 'node:path';
import { installFakeApi, me, route, secureStore } from './helpers';

const APP_DIR = path.join(__dirname, '..', 'src', 'app');

describe('customer session restore (router level)', () => {
  it('a saved session opens the tabs with the four customer tabs', async () => {
    secureStore().set('tf.refreshToken', 'refresh-old');
    installFakeApi([
      route('POST', '/auth/refresh', () => ({
        status: 200,
        body: { accessToken: 'access-2', refreshToken: 'refresh-new', accessExpiresAt: '2026-10-25T10:15:00.000Z', refreshExpiresAt: '2026-11-24T10:00:00.000Z' },
      })),
      route('GET', '/me', () => ({ status: 200, body: me({ customer: { id: 'ca1', type: 'INDIVIDUAL', companyName: null } }) })),
      route('POST', '/me/devices', () => ({ status: 200, body: { ok: true } })),
    ]);

    const r = await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(screen.getByText('Salam, Nizami')).toBeTruthy());
    expect(r.getPathname()).toBe('/');
    expect(secureStore().get('tf.refreshToken')).toBe('refresh-new');
    for (const label of ['Əsas', 'Sifarişlər', 'Pul kisəsi', 'Profil']) expect(screen.getAllByText(label).length).toBeGreaterThan(0);

    await fireEvent.press(screen.getByTestId('tab-profile'));
    await waitFor(() => expect(screen.getByTestId('account-summary')).toBeTruthy());
    expect(screen.getByText('Nizami Tağızadə')).toBeTruthy();
    expect(screen.getByText('+994 50 123 45 67')).toBeTruthy();
  });
});
