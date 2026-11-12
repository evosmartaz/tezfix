import React, { createContext, useContext, type ReactNode } from 'react';
import { useStore } from 'zustand';
import type { QueryClient } from '@tanstack/react-query';
import { api, type ApiClient, type Locale } from '@tezfiks/shared';
import { createAuthStore, type AuthState, type AuthStore } from './auth/store';
import { createMobileApiClient, createSessionApi } from './api/client';
import { createQueryClient } from './query';
import { getApiUrl } from './config';
import { currentLocale } from './i18n';
import { secureStorage, type KeyValueStorage } from './storage';

export type MobileApp = 'CUSTOMER' | 'PRO';

export interface MobileRuntimeOptions {
  app: MobileApp;
  apiUrl?: string;
  storage?: KeyValueStorage;
  fetch?: typeof fetch;
  getLocale?: () => Locale;
  queryClient?: QueryClient;
  validateResponses?: boolean;
  timeoutMs?: number;
}

/** Everything a screen needs to talk to the backend, created once per app process. */
export interface MobileRuntime {
  app: MobileApp;
  apiUrl: string;
  api: ApiClient;
  auth: AuthStore;
  queryClient: QueryClient;
  storage: KeyValueStorage;
}

export function createMobileRuntime(opts: MobileRuntimeOptions): MobileRuntime {
  const apiUrl = opts.apiUrl ?? getApiUrl();
  const storage = opts.storage ?? secureStorage;
  const getLocale = opts.getLocale ?? currentLocale;
  const queryClient = opts.queryClient ?? createQueryClient();
  const session = createSessionApi({ baseUrl: apiUrl, getLocale, fetch: opts.fetch, timeoutMs: opts.timeoutMs });

  // The API client and the auth store reference each other lazily.
  let client: ApiClient;
  const auth = createAuthStore({
    storage,
    refresh: (refreshToken, deviceId) => session.refresh(refreshToken, deviceId),
    fetchMe: () => client.call(api.me.get),
    logoutRemote: (accessToken, refreshToken) => session.logout(accessToken, refreshToken),
    onSignedOut: () => queryClient.clear(),
  });
  client = createMobileApiClient({
    baseUrl: apiUrl,
    auth: () => auth,
    getLocale,
    fetch: opts.fetch,
    validateResponses: opts.validateResponses,
    timeoutMs: opts.timeoutMs,
  });

  return { app: opts.app, apiUrl, api: client, auth, queryClient, storage };
}

const RuntimeContext = createContext<MobileRuntime | null>(null);

export function RuntimeProvider({ runtime, children }: { runtime: MobileRuntime; children: ReactNode }) {
  return <RuntimeContext.Provider value={runtime}>{children}</RuntimeContext.Provider>;
}

export function useRuntime(): MobileRuntime {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error('useRuntime must be used inside <RuntimeProvider>');
  return runtime;
}

/** The authenticated API client. */
export function useApi(): ApiClient {
  return useRuntime().api;
}

/** Selects from the auth store (re-renders on change). */
export function useAuth<T>(selector: (s: AuthState) => T): T {
  return useStore(useRuntime().auth, selector);
}
