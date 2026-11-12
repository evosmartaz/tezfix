import { useEffect, useRef } from 'react';
import { api, type Locale, type Me } from '@tezfiks/shared';
import { i18n, useT } from './i18n';
import { useAuth, useRuntime, type MobileRuntime } from './runtime';

interface PendingSave {
  locale: Locale;
  promise: Promise<Me | null>;
}

/** The save in flight per runtime (the picker and the sync hook share it) and a counter so only the newest answer lands. */
const pending = new WeakMap<MobileRuntime, PendingSave>();
const newest = new WeakMap<MobileRuntime, number>();

/**
 * Saves `locale` as the signed-in user's server language (push texts and server messages use Me.locale) and stores the
 * returned Me. Concurrent calls for the same language share one PATCH /me. Never throws: resolves with the new Me, or
 * null when the call failed. An answer that arrives after a sign-out, for another user, or after a newer language
 * choice was sent, is not stored.
 */
export function saveServerLocale(runtime: MobileRuntime, locale: Locale): Promise<Me | null> {
  const current = pending.get(runtime);
  if (current && current.locale === locale) return current.promise;
  const seq = (newest.get(runtime) ?? 0) + 1;
  newest.set(runtime, seq);
  const userId = runtime.auth.getState().me?.id ?? null;
  const promise: Promise<Me | null> = runtime.api
    .call(api.me.update, { body: { locale } })
    .then((me) => {
      const state = runtime.auth.getState();
      if (newest.get(runtime) === seq && state.status === 'signedIn' && state.me?.id === me.id && me.id === userId) state.setMe(me);
      return me;
    })
    .catch(() => null)
    .finally(() => {
      if (pending.get(runtime)?.promise === promise) pending.delete(runtime);
    });
  pending.set(runtime, { locale, promise });
  return promise;
}

/**
 * Keeps the server language of the signed-in user equal to the language the app shows, so pushes arrive in that
 * language (seen on a device: app in English, pushes in Azerbaijani). Whenever Me.locale differs from the UI language,
 * it saves the UI language once (per user and language: a failure or a server that keeps its own value is not retried
 * until the language or the user changes). Mount it once in the root layout, inside MobileProviders.
 */
export function useServerLocaleSync(): void {
  const runtime = useRuntime();
  const { locale } = useT();
  // Before i18n has initialized, useT reports the default language, which may not be the saved one.
  const ready = i18n.isInitialized;
  const userId = useAuth((s) => (s.status === 'signedIn' ? s.me?.id ?? null : null));
  const serverLocale = useAuth((s) => (s.status === 'signedIn' ? s.me?.locale ?? null : null));
  const attempted = useRef<string | null>(null);

  useEffect(() => {
    if (!userId) attempted.current = null;
  }, [userId]);

  useEffect(() => {
    if (!ready || !userId || !serverLocale || serverLocale === locale) return;
    const key = `${userId}:${locale}`;
    if (attempted.current === key) return;
    attempted.current = key;
    void saveServerLocale(runtime, locale);
  }, [ready, userId, serverLocale, locale, runtime]);
}
