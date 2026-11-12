import { createStore, type StoreApi } from 'zustand/vanilla';
import type { AuthTokens, Me } from '@tezfiks/shared';
import { STORAGE_KEYS, getOrCreateDeviceId, type KeyValueStorage } from '../storage';
import { errorCodeOf, isNetworkError } from '../errors';

/**
 * idle       not started
 * restoring  reading the refresh token and refreshing at startup
 * signedOut  no session (show the login flow)
 * signedIn   access token in memory and `me` loaded
 * offline    a refresh token exists but the server could not be reached (show retry)
 */
export type AuthStatus = 'idle' | 'restoring' | 'signedOut' | 'signedIn' | 'offline';

export interface AuthState {
  status: AuthStatus;
  /** Short-lived access token, memory only (never persisted). */
  accessToken: string | null;
  accessExpiresAt: string | null;
  me: Me | null;
  /** Why the last refresh failed: 'network' keeps the session, 'invalid' ends it. */
  lastRefreshFailure: 'network' | 'invalid' | null;

  /** Startup: refresh token from SecureStore → new access token → GET /me. */
  restore(): Promise<void>;
  /** After OTP verify: persists the refresh token and stores the session. */
  signIn(tokens: AuthTokens, me: Me): Promise<void>;
  setMe(me: Me): void;
  /** Rotates tokens via POST /auth/refresh. Single-flight; true when a new access token is available. */
  refreshAccessToken(): Promise<boolean>;
  /** Ends the session (best-effort server logout, then local cleanup). */
  logout(opts?: { remote?: boolean }): Promise<void>;
  /** Called by the API client when a 401 could not be recovered. */
  handleAuthFailure(): void;
  getDeviceId(): Promise<string>;
}

export interface AuthStoreDeps {
  storage: KeyValueStorage;
  /** POST /auth/refresh without auth headers. */
  refresh(refreshToken: string, deviceId: string): Promise<AuthTokens>;
  /** GET /me with the current access token. */
  fetchMe(): Promise<Me>;
  /** POST /auth/logout with the given access token (best effort). */
  logoutRemote?(accessToken: string, refreshToken: string | null): Promise<void>;
  /** Runs after every sign-out (clear caches, disconnect the socket). */
  onSignedOut?(): void;
}

export type AuthStore = StoreApi<AuthState>;

const SESSION_ENDING_CODES = new Set(['REFRESH_INVALID', 'SESSION_REVOKED', 'UNAUTHORIZED', 'USER_BLOCKED']);

function isSessionEnding(err: unknown): boolean {
  if (isNetworkError(err)) return false;
  const status = (err as { status?: number })?.status;
  return SESSION_ENDING_CODES.has(errorCodeOf(err)) || status === 401 || status === 403;
}

export function createAuthStore(deps: AuthStoreDeps): AuthStore {
  let inflight: Promise<boolean> | null = null;
  let deviceIdPromise: Promise<string> | null = null;

  const getDeviceId = () => {
    deviceIdPromise ??= getOrCreateDeviceId(deps.storage);
    return deviceIdPromise;
  };

  return createStore<AuthState>((set, get) => {
    /** Bumped on every sign-out/sign-in: a refresh that started in an older session must not write its tokens. */
    let epoch = 0;

    const clearLocal = async () => {
      epoch++;
      await deps.storage.removeItem(STORAGE_KEYS.refreshToken).catch(() => undefined);
      const wasSignedIn = get().status !== 'signedOut' || get().accessToken !== null;
      set({ status: 'signedOut', accessToken: null, accessExpiresAt: null, me: null });
      if (wasSignedIn) deps.onSignedOut?.();
    };

    const doRefresh = async (): Promise<boolean> => {
      const started = epoch;
      const refreshToken = await deps.storage.getItem(STORAGE_KEYS.refreshToken).catch(() => null);
      if (!refreshToken) {
        set({ lastRefreshFailure: 'invalid' });
        return false;
      }
      try {
        const tokens = await deps.refresh(refreshToken, await getDeviceId());
        if (started !== epoch) return false; // signed out (or in again) meanwhile
        await deps.storage.setItem(STORAGE_KEYS.refreshToken, tokens.refreshToken);
        set({ accessToken: tokens.accessToken, accessExpiresAt: tokens.accessExpiresAt, lastRefreshFailure: null });
        return true;
      } catch (err) {
        if (started !== epoch) return false;
        if (isSessionEnding(err)) {
          set({ lastRefreshFailure: 'invalid' });
          await clearLocal();
        } else {
          set({ lastRefreshFailure: 'network' });
        }
        return false;
      }
    };

    /**
     * Best-effort server revocation. The access token lives 15 minutes, so a user idle on the profile tab usually
     * holds an expired one: on a 401 refresh once (rotating the refresh token) and retry, so the server session and
     * its refresh-token chain are really revoked. Without an access token in memory (offline start) refresh first.
     * No device-clock check: a skewed phone clock must not decide whether the token is still valid.
     */
    const revokeRemote = async (logoutRemote: NonNullable<AuthStoreDeps['logoutRemote']>) => {
      if (!get().accessToken) {
        const hasRefresh = !!(await deps.storage.getItem(STORAGE_KEYS.refreshToken).catch(() => null));
        if (!hasRefresh || !(await get().refreshAccessToken())) return;
      }
      const attempt = async () => {
        const token = get().accessToken;
        if (!token) return;
        const refreshToken = await deps.storage.getItem(STORAGE_KEYS.refreshToken).catch(() => null);
        await logoutRemote(token, refreshToken);
      };
      try {
        await attempt();
      } catch (err) {
        const status = (err as { status?: number })?.status;
        const unauthorized = status === 401 || errorCodeOf(err) === 'UNAUTHORIZED';
        if (!unauthorized || !(await get().refreshAccessToken())) return;
        await attempt();
      }
    };

    return {
      status: 'idle',
      accessToken: null,
      accessExpiresAt: null,
      me: null,
      lastRefreshFailure: null,

      getDeviceId,

      async restore() {
        set({ status: 'restoring' });
        const refreshToken = await deps.storage.getItem(STORAGE_KEYS.refreshToken).catch(() => null);
        if (!refreshToken) {
          set({ status: 'signedOut', accessToken: null, me: null });
          return;
        }
        const ok = await get().refreshAccessToken();
        if (!ok) {
          set({ status: get().lastRefreshFailure === 'network' ? 'offline' : 'signedOut' });
          return;
        }
        try {
          const me = await deps.fetchMe();
          set({ me, status: 'signedIn' });
        } catch (err) {
          // Only a rejected session ends it. Server errors (5xx, 429, contract mismatch) keep the freshly rotated
          // refresh token and show the retry screen, exactly like the refresh path does.
          if (isSessionEnding(err)) {
            if (get().status !== 'signedOut') await clearLocal();
          } else if (get().status !== 'signedOut') {
            set({ status: 'offline' });
          }
        }
      },

      async signIn(tokens, me) {
        epoch++;
        await deps.storage.setItem(STORAGE_KEYS.refreshToken, tokens.refreshToken);
        set({
          status: 'signedIn',
          accessToken: tokens.accessToken,
          accessExpiresAt: tokens.accessExpiresAt,
          me,
          lastRefreshFailure: null,
        });
      },

      setMe(me) {
        set({ me });
      },

      refreshAccessToken() {
        inflight ??= doRefresh().finally(() => {
          inflight = null;
        });
        return inflight;
      },

      async logout(opts = {}) {
        const remote = opts.remote ?? true;
        // Let a rotation in flight finish first so the revoke uses (and SecureStore keeps no copy of) the newest pair.
        if (inflight) await inflight.catch(() => false);
        if (remote && deps.logoutRemote) await revokeRemote(deps.logoutRemote).catch(() => undefined);
        await clearLocal();
      },

      handleAuthFailure() {
        if (get().lastRefreshFailure === 'network') return;
        void clearLocal();
      },
    };
  });
}
