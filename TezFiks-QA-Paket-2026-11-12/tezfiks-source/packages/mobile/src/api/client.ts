import { api, createApiClient, type ApiClient, type AuthTokens, type Locale, type Me } from '@tezfiks/shared';
import * as Crypto from 'expo-crypto';
import type { AuthStore } from '../auth/store';
import { createAppFetch } from './fetch';

/** Default transport: the global fetch, except multipart uploads (see createAppFetch). */
const appFetch = createAppFetch();

export interface MobileApiOptions {
  baseUrl: string;
  auth: () => AuthStore;
  getLocale: () => Locale;
  fetch?: typeof fetch;
  /** Validate every response with the contract (useful while developing against a changing API). */
  validateResponses?: boolean;
  timeoutMs?: number;
}

/** Idempotency keys for money/accept calls (Hermes has no global crypto.randomUUID). */
export function newIdempotencyKey(): string {
  try {
    return Crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  }
}

/**
 * The authenticated client used by screens: bearer token from the auth store (memory),
 * one refresh-and-retry on 401, sign-out when the session cannot be recovered, Accept-Language from i18n.
 */
export function createMobileApiClient(opts: MobileApiOptions): ApiClient {
  return createApiClient({
    baseUrl: opts.baseUrl,
    fetch: opts.fetch ?? appFetch,
    getLocale: opts.getLocale,
    getAccessToken: () => opts.auth().getState().accessToken,
    refreshAccessToken: () => opts.auth().getState().refreshAccessToken(),
    onAuthFailure: () => opts.auth().getState().handleAuthFailure(),
    validateResponses: opts.validateResponses,
    timeoutMs: opts.timeoutMs,
    newIdempotencyKey,
  });
}

/** Unauthenticated client for the session endpoints themselves (refresh, logout); never triggers refresh loops. */
export function createSessionApi(opts: { baseUrl: string; getLocale: () => Locale; fetch?: typeof fetch; timeoutMs?: number }) {
  const bare = createApiClient({ baseUrl: opts.baseUrl, fetch: opts.fetch ?? appFetch, getLocale: opts.getLocale, timeoutMs: opts.timeoutMs });
  return {
    refresh(refreshToken: string, deviceId: string): Promise<AuthTokens> {
      return bare.call(api.auth.refresh, { body: { refreshToken, deviceId } });
    },
    async logout(accessToken: string, refreshToken: string | null): Promise<void> {
      await bare.call(api.auth.logout, {
        body: refreshToken ? { refreshToken } : {},
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    },
    me(accessToken: string): Promise<Me> {
      return bare.call(api.me.get, { headers: { Authorization: `Bearer ${accessToken}` } });
    },
  };
}
