import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { I18nextProvider } from 'react-i18next';
import { resolveEntry, type EntryTarget } from './auth/route';
import { i18n, initI18n, type AppNamespace } from './i18n';
import { ensureNotificationChannels, registerForPush, type RegisterPushResult } from './push';
import { configureQueryManagers } from './query';
import { RuntimeProvider, useAuth, useRuntime, type MobileRuntime } from './runtime';
import { SocketProvider } from './socket';
import { useAppFonts } from './theme/fonts';
import { ToastProvider } from './ui/Toast';

/** Provider stack shared by both apps: safe area → runtime → react-query → i18n → toasts → socket. */
export function MobileProviders({ runtime, children }: { runtime: MobileRuntime; children: ReactNode }) {
  return (
    <SafeAreaProvider>
      <RuntimeProvider runtime={runtime}>
        <QueryClientProvider client={runtime.queryClient}>
          <I18nextProvider i18n={i18n}>
            <ToastProvider>
              <SocketProvider>{children}</SocketProvider>
            </ToastProvider>
          </I18nextProvider>
        </QueryClientProvider>
      </RuntimeProvider>
    </SafeAreaProvider>
  );
}

/**
 * Startup: fonts, i18n (saved language → device → az), react-query online/focus managers, session restore.
 * Returns true once the first screen can render.
 */
export function useBootstrap(runtime: MobileRuntime, appNamespace: AppNamespace): boolean {
  const fontsReady = useAppFonts();
  const [i18nReady, setI18nReady] = useState(i18n.isInitialized);

  useEffect(() => configureQueryManagers(), []);

  useEffect(() => {
    let alive = true;
    initI18n({ appNamespace, storage: runtime.storage })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setI18nReady(true);
      });
    return () => {
      alive = false;
    };
  }, [appNamespace, runtime]);

  useEffect(() => {
    if (runtime.auth.getState().status === 'idle') void runtime.auth.getState().restore();
  }, [runtime]);

  return fontsReady && i18nReady;
}

/** Where the signed-in/out user belongs (see resolveEntry). */
export function useEntryTarget(): EntryTarget {
  const runtime = useRuntime();
  const status = useAuth((s) => s.status);
  const me = useAuth((s) => s.me);
  return resolveEntry(runtime.app, status, me);
}

/**
 * Registers the device for push once per signed-in session (non-fatal on failure).
 * Waits for translated channel names (they are empty strings until i18n has initialized), registers again after a
 * sign-out/sign-in in the same process, and renames the Android channels when the UI language changes.
 */
export function usePushRegistration(channelNames: { offers: string; default: string }): RegisterPushResult | null {
  const runtime = useRuntime();
  const userId = useAuth((s) => (s.status === 'signedIn' ? s.me?.id ?? null : null));
  const [result, setResult] = useState<RegisterPushResult | null>(null);
  const done = useRef<string | null>(null);
  const appliedNames = useRef<string | null>(null);
  const names = useRef(channelNames);
  names.current = channelNames;
  const namesReady = !!channelNames.offers && !!channelNames.default;
  const namesKey = `${channelNames.offers}\u0000${channelNames.default}`;

  useEffect(() => {
    if (!userId) done.current = null; // a new session (even the same user) registers again
  }, [userId]);

  useEffect(() => {
    if (!userId || !namesReady || done.current === userId) return;
    done.current = userId;
    appliedNames.current = namesKey;
    let alive = true;
    (async () => {
      const deviceId = await runtime.auth.getState().getDeviceId();
      const res = await registerForPush({ api: runtime.api, app: runtime.app, deviceId, channelNames: names.current });
      if (alive) setResult(res);
    })().catch(() => undefined);
    return () => {
      alive = false;
    };
    // namesKey is deliberately not a dependency: a language change renames the channels (below), it does not re-register.
  }, [userId, namesReady, runtime]);

  useEffect(() => {
    if (!done.current || !namesReady || appliedNames.current === namesKey) return;
    appliedNames.current = namesKey;
    void ensureNotificationChannels(names.current).catch(() => undefined);
  }, [namesKey, namesReady]);

  return result;
}
