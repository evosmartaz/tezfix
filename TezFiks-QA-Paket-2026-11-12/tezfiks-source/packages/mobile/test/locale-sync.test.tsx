import React, { type ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { Me } from '@tezfiks/shared';
import { i18n, initI18n } from '../src/i18n';
import { useServerLocaleSync } from '../src/localeSync';
import { createMobileRuntime, RuntimeProvider, type MobileRuntime } from '../src/runtime';
import { createMemoryStorage } from '../src/storage';
import { LanguagePicker } from '../src/ui/LanguagePicker';
import { makeMe } from './fixtures';

const BASE = 'http://10.0.2.2:3000/tezfix/api';
const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const tokens = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  accessExpiresAt: '2099-10-25T10:15:00.000Z',
  refreshExpiresAt: '2099-11-24T10:00:00.000Z',
};

type Reply = { status: number; body?: unknown } | Promise<{ status: number; body?: unknown }>;

function setup(onPatch: (body: { locale?: string }) => Reply = (b) => ({ status: 200, body: makeMe({ locale: b.locale as Me['locale'] }) })) {
  const patches: Array<{ locale?: string }> = [];
  const fetchFn = jest.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const path = String(input).replace(BASE, '');
    if (path === '/me' && init.method === 'PATCH') {
      const body = JSON.parse(String(init.body)) as { locale?: string };
      patches.push(body);
      const r = await onPatch(body);
      return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'x' } }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
  const runtime = createMobileRuntime({ app: 'CUSTOMER', apiUrl: BASE, storage: createMemoryStorage(), fetch: fetchFn, getLocale: () => 'az' });
  const wrap = (node: ReactNode) => (
    <SafeAreaProvider initialMetrics={metrics}>
      <RuntimeProvider runtime={runtime}>{node}</RuntimeProvider>
    </SafeAreaProvider>
  );
  return { runtime, patches, wrap };
}

function Sync({ children }: { children?: ReactNode }) {
  useServerLocaleSync();
  return <>{children}</>;
}

async function signIn(runtime: MobileRuntime, me: Me = makeMe({ locale: 'az' })) {
  await act(async () => {
    await runtime.auth.getState().signIn(tokens, me);
  });
}

async function setLanguage(lng: 'az' | 'ru' | 'en') {
  await act(async () => {
    await i18n.changeLanguage(lng);
  });
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

beforeAll(async () => {
  await initI18n({ appNamespace: 'customer', storage: createMemoryStorage(), language: 'az' });
});

afterEach(async () => {
  await setLanguage('az');
});

/**
 * Pushes are written in the user's server locale (Me.locale). Seen on a device: the app in English, pushes in Azerbaijani.
 * While signed in, the app's language is saved on the server once whenever the two differ.
 */
describe('useServerLocaleSync', () => {
  it('saves the app language on the server once when it differs from Me.locale, and stores the returned Me', async () => {
    const { runtime, patches, wrap } = setup();
    await setLanguage('en');
    await signIn(runtime);
    const view = await render(wrap(<Sync />));
    await waitFor(() => expect(runtime.auth.getState().me?.locale).toBe('en'));
    expect(patches).toEqual([{ locale: 'en' }]);
    await view.rerender(wrap(<Sync />));
    await settle();
    expect(patches).toHaveLength(1);
  });

  it('does nothing when the server already has the app language', async () => {
    const { runtime, patches, wrap } = setup();
    await signIn(runtime, makeMe({ locale: 'az' }));
    await render(wrap(<Sync />));
    await settle();
    expect(patches).toHaveLength(0);
  });

  it('does nothing while signed out, then syncs right after sign-in', async () => {
    const { runtime, patches, wrap } = setup();
    await setLanguage('ru');
    await render(wrap(<Sync />));
    await settle();
    expect(patches).toHaveLength(0);
    await signIn(runtime);
    await waitFor(() => expect(patches).toEqual([{ locale: 'ru' }]));
  });

  it('a failed save is not retried in a loop (no retry storm)', async () => {
    const { runtime, patches, wrap } = setup(() => ({ status: 500, body: { error: { code: 'INTERNAL', message: 'x' } } }));
    await setLanguage('en');
    await signIn(runtime);
    const view = await render(wrap(<Sync />));
    await waitFor(() => expect(patches).toHaveLength(1));
    // Unrelated profile updates and re-renders do not trigger new attempts.
    await act(async () => runtime.auth.getState().setMe(makeMe({ locale: 'az', firstName: 'Aysel' })));
    await view.rerender(wrap(<Sync />));
    await settle();
    expect(patches).toHaveLength(1);
    expect(runtime.auth.getState().me?.locale).toBe('az');
  });

  it('a server that keeps its own locale does not cause a loop', async () => {
    const { runtime, patches, wrap } = setup(() => ({ status: 200, body: makeMe({ locale: 'az' }) }));
    await setLanguage('en');
    await signIn(runtime);
    await render(wrap(<Sync />));
    await waitFor(() => expect(patches).toHaveLength(1));
    await settle();
    expect(patches).toHaveLength(1);
  });

  it('a later language change is saved again (once)', async () => {
    const { runtime, patches, wrap } = setup();
    await setLanguage('en');
    await signIn(runtime);
    await render(wrap(<Sync />));
    await waitFor(() => expect(runtime.auth.getState().me?.locale).toBe('en'));
    await setLanguage('ru');
    await waitFor(() => expect(runtime.auth.getState().me?.locale).toBe('ru'));
    await settle();
    expect(patches).toEqual([{ locale: 'en' }, { locale: 'ru' }]);
  });

  it('the LanguagePicker and the sync share one request for an explicit choice', async () => {
    const { runtime, patches, wrap } = setup();
    await signIn(runtime);
    await render(
      wrap(
        <Sync>
          <LanguagePicker />
        </Sync>,
      ),
    );
    await settle();
    expect(patches).toHaveLength(0);
    await fireEvent.press(screen.getByTestId('language-picker-ru'));
    await waitFor(() => expect(runtime.auth.getState().me?.locale).toBe('ru'));
    await settle();
    expect(patches).toEqual([{ locale: 'ru' }]);
  });

  it('an answer that arrives after sign-out does not bring the profile back', async () => {
    let release: (r: { status: number; body?: unknown }) => void = () => undefined;
    const { runtime, patches, wrap } = setup(() => new Promise((resolve) => (release = resolve)));
    await setLanguage('en');
    await signIn(runtime);
    await render(wrap(<Sync />));
    await waitFor(() => expect(patches).toHaveLength(1));
    await act(async () => {
      await runtime.auth.getState().logout({ remote: false });
    });
    await act(async () => {
      release({ status: 200, body: makeMe({ locale: 'en' }) });
    });
    await settle();
    expect(runtime.auth.getState().status).toBe('signedOut');
    expect(runtime.auth.getState().me).toBeNull();
  });
});
