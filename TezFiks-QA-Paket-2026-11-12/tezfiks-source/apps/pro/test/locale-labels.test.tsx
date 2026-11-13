import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import path from 'node:path';
import { router } from 'expo-router';
import { onlineManager } from '@tanstack/react-query';
import { i18n } from '@tezfiks/mobile';
import { installFakeApi, me, route, secureStore, type FakeCall } from './helpers';
import { header, resetApp, signedIn, UUID } from './pro-helpers';
import { profileResponse, proProfile } from './fixtures';

// BUG-005: trade names come from the server in the language of the Accept-Language header. After a language change the
// profile card must show them in the new language (QA: AU-O07, "İxtisaslar" stayed Azerbaijani under RU and EN).
const APP_DIR = path.join(__dirname, '..', 'src', 'app');
const SOLO = { id: UUID(1), kind: 'SOLO', status: 'APPROVED', companyId: null, isOnline: false };

type Lng = 'az' | 'ru' | 'en';
const NAMES: Record<Lng, string[]> = {
  az: ['Santexnik', 'Kombi / istilik'],
  ru: ['Сантехник', 'Котлы и отопление'],
  en: ['Plumber', 'Boilers & heating'],
};
const LABEL: Record<Lng, RegExp> = {
  az: /Santexnik, Kombi \/ istilik/,
  ru: /Сантехник, Котлы и отопление/,
  en: /Plumber, Boilers & heating/,
};
const lngOf = (call: FakeCall): Lng => (header(call, 'Accept-Language') ?? 'az') as Lng;

/** Fake API whose /pro/profile answers in the request language; returns the calls and a switch that makes it fail. */
function installLocalizedApi() {
  let current = me({ handyman: SOLO });
  const state = { down: false };
  const calls = installFakeApi([
    ...signedIn(() => current),
    route('PATCH', '/me', (call) => {
      current = { ...current, ...(call.body as object) };
      return { status: 200, body: current };
    }),
    route('GET', '/pro/profile', (call) => {
      if (state.down) return { status: 503, body: { error: { code: 'INTERNAL', message: 'down' } } };
      const trades = NAMES[lngOf(call)].map((name, i) => ({ id: UUID(0xc1 + i), slug: `trade-${i}`, name, icon: null, vertical: 'HOME' as const }));
      return { status: 200, body: profileResponse({ profile: proProfile({ trades }) }) };
    }),
  ]);
  const profileLanguages = () => calls.filter((c) => c.method === 'GET' && c.path === '/pro/profile').map(lngOf);
  return { calls, state, profileLanguages };
}

async function openProfile() {
  await renderRouter(APP_DIR, { initialUrl: '/profile' });
  await waitFor(() => expect(screen.getByTestId('profile-work')).toBeTruthy());
}

async function pick(lng: Lng) {
  await fireEvent.press(screen.getByTestId(`language-picker-${lng}`));
}

async function expectOnly(lng: Lng) {
  await waitFor(() => expect(screen.getByText(LABEL[lng])).toBeTruthy());
  for (const other of (['az', 'ru', 'en'] as Lng[]).filter((l) => l !== lng)) expect(screen.queryByText(LABEL[other])).toBeNull();
}

afterEach(async () => {
  onlineManager.setOnline(true);
  await resetApp();
  await act(async () => {
    await i18n.changeLanguage('az');
  });
});

describe('BUG-005: trade names follow the app language', () => {
  it('AZ -> EN -> RU -> AZ: every switch reloads the profile in the new language and keeps the rest of the card', async () => {
    const api = installLocalizedApi();
    await openProfile();
    await expectOnly('az');
    expect(screen.getByText('Xidmət radiusu: 10 km')).toBeTruthy();

    await pick('en');
    await expectOnly('en');
    expect(screen.getByText('Trades: Plumber, Boilers & heating')).toBeTruthy();
    expect(screen.getByText('Service radius: 10 km')).toBeTruthy();

    await pick('ru');
    await expectOnly('ru');

    await pick('az');
    await expectOnly('az');
    expect(screen.getByText('İxtisaslar: Santexnik, Kombi / istilik')).toBeTruthy();

    expect(api.profileLanguages()).toEqual(['az', 'en', 'ru', 'az']);
    expect(secureStore().get('tf.language')).toBe('az');
  });

  it('quick repeated switching ends on the last language chosen', async () => {
    installLocalizedApi();
    await openProfile();
    await pick('en');
    await pick('ru');
    await pick('en');
    await pick('ru');
    await expectOnly('ru');
  });

  it('leaving the profile screen and coming back still shows the new language', async () => {
    installLocalizedApi();
    await openProfile();
    await pick('en');
    await expectOnly('en');
    await fireEvent.press(screen.getByTestId('profile-device-setup'));
    await waitFor(() => expect(screen.getByTestId('device-setup-screen')).toBeTruthy());
    await act(async () => {
      router.back();
    });
    await waitFor(() => expect(screen.getByTestId('profile-work')).toBeTruthy());
    await expectOnly('en');
  });

  it('after a restart the saved language is used for the first profile request', async () => {
    const api = installLocalizedApi();
    secureStore().set('tf.language', 'en'); // what the picker stored before the app was closed
    await openProfile();
    await expectOnly('en');
    expect(api.profileLanguages()[0]).toBe('en');
  });

  it('while the server cannot be reached the card keeps the last names; they update once it answers again', async () => {
    const api = installLocalizedApi();
    await openProfile();
    await expectOnly('az');

    api.state.down = true;
    await pick('ru');
    // The UI language changed, the reload failed: the old names stay on screen and nothing crashes.
    await waitFor(() => expect(screen.getByText(/^Специальности: /)).toBeTruthy());
    await waitFor(() => expect(api.profileLanguages()).toContain('ru'));
    expect(screen.getByText(LABEL.az)).toBeTruthy();
    expect(screen.getByTestId('profile-work')).toBeTruthy();

    api.state.down = false;
    await act(async () => {
      onlineManager.setOnline(false);
      onlineManager.setOnline(true); // connectivity is back: stale queries refetch
    });
    await expectOnly('ru');
  });
});
