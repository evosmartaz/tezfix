import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import path from 'node:path';
import { installFakeApi, me, route, secureStore, TOKENS } from './helpers';
import { installPro, ok, on, settle, SOLO_ME } from './m4-helpers';
import { resetApp } from './pro-helpers';

const APP_DIR = path.join(__dirname, '..', 'src', 'app');

describe('pro session restore (router level)', () => {
  it('a solo handyman lands on the four pro tabs and can switch language to Russian', async () => {
    secureStore().set('tf.refreshToken', 'refresh-old');
    const profile = me({
      firstName: 'Elvin',
      lastName: 'Məmmədov',
      handyman: { id: 'h1', kind: 'SOLO', status: 'APPROVED', companyId: null, isOnline: false },
    });
    const calls = installFakeApi([
      route('POST', '/auth/refresh', () => ({ status: 200, body: { ...TOKENS, refreshToken: 'refresh-new' } })),
      route('GET', '/me', () => ({ status: 200, body: profile })),
      route('PATCH', '/me', (c) => ({ status: 200, body: { ...profile, locale: (c.body as { locale: string }).locale } })),
      route('POST', '/me/devices', () => ({ status: 200, body: { ok: true } })),
    ]);

    const r = await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(screen.getByText('Salam, Elvin')).toBeTruthy());
    expect(r.getPathname()).toBe('/');
    for (const label of ['Əsas', 'Sifarişlər', 'Balans', 'Profil']) expect(screen.getAllByText(label).length).toBeGreaterThan(0);

    await fireEvent.press(screen.getByTestId('tab-profile'));
    await waitFor(() => expect(screen.getByTestId('account-summary')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('language-picker-ru'));
    await waitFor(() => expect(screen.getAllByText('Профиль').length).toBeGreaterThan(0));
    expect(secureStore().get('tf.language')).toBe('ru');
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ locale: 'ru' }));
  });
});

describe('server language follows the app language (pushes are written in Me.locale)', () => {
  beforeEach(() => resetApp());
  afterEach(() => resetApp());

  const elvin = me({ firstName: 'Elvin', lastName: 'Məmmədov', locale: 'az', handyman: SOLO_ME });
  const patches = (world: { calls: Array<{ method: string; path: string }> }) => world.calls.filter((c) => c.method === 'PATCH' && c.path === '/me');

  it('an app shown in English saves English on the server once', async () => {
    const world = installPro({ me: { locale: 'az' }, routes: [on('PATCH', '/me', (c) => ok({ ...elvin, ...(c.body as object) }))] });
    secureStore().set('tf.language', 'en');
    await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(patches(world)).toHaveLength(1));
    expect((patches(world)[0] as { body?: unknown }).body).toEqual({ locale: 'en' });
    await settle(100);
    expect(patches(world)).toHaveLength(1);
  });

  it('no call when the profile already has the app language', async () => {
    const world = installPro({ me: { locale: 'az' }, routes: [on('PATCH', '/me', (c) => ok({ ...elvin, ...(c.body as object) }))] });
    secureStore().set('tf.language', 'az');
    await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(screen.getByText('Salam, Elvin')).toBeTruthy());
    await settle(100);
    expect(patches(world)).toHaveLength(0);
  });
});
