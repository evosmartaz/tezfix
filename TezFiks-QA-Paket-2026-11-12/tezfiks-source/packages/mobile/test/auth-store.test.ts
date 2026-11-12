import { ApiError, type AuthTokens } from '@tezfiks/shared';
import { createAuthStore, type AuthStoreDeps } from '../src/auth/store';
import { createMemoryStorage, STORAGE_KEYS } from '../src/storage';
import { makeMe } from './fixtures';

function tokens(n: number): AuthTokens {
  return {
    accessToken: `access-${n}`,
    refreshToken: `refresh-${n}`,
    accessExpiresAt: '2026-10-25T10:15:00.000Z',
    refreshExpiresAt: '2026-11-24T10:00:00.000Z',
  };
}

function setup(opts: { refreshToken?: string; deps?: Partial<AuthStoreDeps> } = {}) {
  const storage = createMemoryStorage(opts.refreshToken ? { [STORAGE_KEYS.refreshToken]: opts.refreshToken } : {});
  let n = 1;
  const deps = {
    storage,
    refresh: jest.fn(async () => tokens(++n)),
    fetchMe: jest.fn(async () => makeMe()),
    logoutRemote: jest.fn(async () => undefined),
    onSignedOut: jest.fn(),
    ...opts.deps,
  };
  const store = createAuthStore(deps as AuthStoreDeps);
  return { store, storage, deps };
}

describe('auth store', () => {
  it('restore without a refresh token signs out without calling the server', async () => {
    const { store, deps } = setup();
    expect(store.getState().status).toBe('idle');
    await store.getState().restore();
    expect(store.getState().status).toBe('signedOut');
    expect(deps.refresh).not.toHaveBeenCalled();
    expect(deps.fetchMe).not.toHaveBeenCalled();
  });

  it('restore rotates the refresh token, keeps the access token in memory only and loads me', async () => {
    const { store, storage, deps } = setup({ refreshToken: 'refresh-1' });
    await store.getState().restore();
    const s = store.getState();
    expect(s.status).toBe('signedIn');
    expect(s.accessToken).toBe('access-2');
    expect(s.me?.id).toBe('u1');
    expect(deps.refresh).toHaveBeenCalledWith('refresh-1', expect.any(String));
    const deviceId = ((deps.refresh as jest.Mock).mock.calls[0] as [string, string])[1];
    expect(deviceId.length).toBeGreaterThanOrEqual(8);
    expect(storage.data.get(STORAGE_KEYS.refreshToken)).toBe('refresh-2');
    expect([...storage.data.values()]).not.toContain('access-2');
    expect(storage.data.get(STORAGE_KEYS.deviceId)).toBe(deviceId);
  });

  it('reuses the same device id across refreshes', async () => {
    const { store, deps } = setup({ refreshToken: 'refresh-1' });
    await store.getState().refreshAccessToken();
    await store.getState().refreshAccessToken();
    const ids = (deps.refresh as jest.Mock).mock.calls.map((c: unknown[]) => c[1] as string);
    expect(ids[0]).toBe(ids[1]);
    expect(await store.getState().getDeviceId()).toBe(ids[0]);
  });

  it('refresh is single-flight: concurrent 401s trigger one rotation', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const refresh = jest.fn(async () => {
      await gate;
      return tokens(7);
    });
    const { store } = setup({ refreshToken: 'refresh-1', deps: { refresh } });
    const a = store.getState().refreshAccessToken();
    const b = store.getState().refreshAccessToken();
    const c = store.getState().refreshAccessToken();
    release();
    await expect(Promise.all([a, b, c])).resolves.toEqual([true, true, true]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(store.getState().accessToken).toBe('access-7');
    // A later refresh starts a new request.
    await store.getState().refreshAccessToken();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('an invalid refresh token ends the session and clears SecureStore', async () => {
    const refresh = jest.fn(async () => {
      throw new ApiError(401, 'REFRESH_INVALID', 'expired');
    });
    const { store, storage, deps } = setup({ refreshToken: 'refresh-1', deps: { refresh } });
    await store.getState().restore();
    expect(store.getState().status).toBe('signedOut');
    expect(store.getState().accessToken).toBeNull();
    expect(storage.data.has(STORAGE_KEYS.refreshToken)).toBe(false);
    expect(deps.fetchMe).not.toHaveBeenCalled();
    expect(store.getState().lastRefreshFailure).toBe('invalid');
  });

  it('a revoked session (reused refresh token) also signs out', async () => {
    const refresh = jest.fn(async () => {
      throw new ApiError(401, 'SESSION_REVOKED', 'revoked');
    });
    const { store, storage } = setup({ refreshToken: 'refresh-1', deps: { refresh } });
    await store.getState().signIn(tokens(1), makeMe());
    await expect(store.getState().refreshAccessToken()).resolves.toBe(false);
    expect(store.getState().status).toBe('signedOut');
    expect(store.getState().me).toBeNull();
    expect(storage.data.has(STORAGE_KEYS.refreshToken)).toBe(false);
  });

  it('a network failure during restore keeps the session and reports offline', async () => {
    const refresh = jest.fn(async () => {
      throw new ApiError(0, 'NETWORK', 'Network request failed');
    });
    const { store, storage, deps } = setup({ refreshToken: 'refresh-1', deps: { refresh } });
    await store.getState().restore();
    expect(store.getState().status).toBe('offline');
    expect(storage.data.get(STORAGE_KEYS.refreshToken)).toBe('refresh-1');
    expect(deps.onSignedOut).not.toHaveBeenCalled();
    // The API client reporting an unrecoverable 401 right after a network failure must not log out.
    store.getState().handleAuthFailure();
    await Promise.resolve();
    expect(storage.data.get(STORAGE_KEYS.refreshToken)).toBe('refresh-1');
  });

  it('a network failure while loading me reports offline', async () => {
    const fetchMe = jest.fn(async () => {
      throw new ApiError(0, 'TIMEOUT', 'timeout');
    });
    const { store } = setup({ refreshToken: 'refresh-1', deps: { fetchMe } });
    await store.getState().restore();
    expect(store.getState().status).toBe('offline');
  });

  it('a blocked user is signed out when me cannot be loaded', async () => {
    const fetchMe = jest.fn(async () => {
      throw new ApiError(403, 'USER_BLOCKED', 'blocked');
    });
    const { store, storage } = setup({ refreshToken: 'refresh-1', deps: { fetchMe } });
    await store.getState().restore();
    expect(store.getState().status).toBe('signedOut');
    expect(storage.data.has(STORAGE_KEYS.refreshToken)).toBe(false);
  });

  it.each([
    ['a 500 INTERNAL', () => new ApiError(500, 'INTERNAL', 'boom')],
    ['a 503 without a JSON body', () => new ApiError(503, 'HTTP_503', 'Service Unavailable')],
    ['a 429 RATE_LIMITED', () => new ApiError(429, 'RATE_LIMITED', 'slow down')],
    ['a contract mismatch', () => new ApiError(200, 'CONTRACT_MISMATCH', 'bad shape')],
    ['an unexpected exception', () => new TypeError('Cannot read properties of undefined')],
  ])('%s while loading me keeps the rotated session and reports offline', async (_label, makeErr) => {
    const fetchMe: jest.Mock = jest.fn(async () => {
      throw makeErr();
    });
    const { store, storage, deps } = setup({ refreshToken: 'refresh-1', deps: { fetchMe } });
    await store.getState().restore();
    expect(store.getState().status).toBe('offline');
    expect(storage.data.get(STORAGE_KEYS.refreshToken)).toBe('refresh-2');
    expect(deps.onSignedOut).not.toHaveBeenCalled();
    // Retrying later (offline screen) signs in with the kept session.
    fetchMe.mockImplementation(async () => makeMe());
    await store.getState().restore();
    expect(store.getState().status).toBe('signedIn');
    expect(deps.refresh).toHaveBeenLastCalledWith('refresh-2', expect.any(String));
  });

  it('an unauthorized me (session rejected after refresh) signs out', async () => {
    const fetchMe = jest.fn(async () => {
      throw new ApiError(401, 'UNAUTHORIZED', 'no');
    });
    const { store, storage } = setup({ refreshToken: 'refresh-1', deps: { fetchMe } });
    await store.getState().restore();
    expect(store.getState().status).toBe('signedOut');
    expect(storage.data.has(STORAGE_KEYS.refreshToken)).toBe(false);
  });

  it('signIn persists only the refresh token', async () => {
    const { store, storage } = setup();
    await store.getState().signIn(tokens(3), makeMe({ firstName: 'Aysel' }));
    expect(store.getState()).toMatchObject({ status: 'signedIn', accessToken: 'access-3' });
    expect(store.getState().me?.firstName).toBe('Aysel');
    expect(storage.data.get(STORAGE_KEYS.refreshToken)).toBe('refresh-3');
    expect([...storage.data.values()]).not.toContain('access-3');
  });

  it('setMe replaces the profile', async () => {
    const { store } = setup();
    await store.getState().signIn(tokens(3), makeMe({ profileComplete: false, firstName: null }));
    store.getState().setMe(makeMe({ firstName: 'Ülvi' }));
    expect(store.getState().me?.firstName).toBe('Ülvi');
  });

  it('logout revokes on the server, clears storage and state, and notifies', async () => {
    const { store, storage, deps } = setup();
    await store.getState().signIn(tokens(4), makeMe());
    await store.getState().logout();
    expect(deps.logoutRemote).toHaveBeenCalledWith('access-4', 'refresh-4');
    expect(storage.data.has(STORAGE_KEYS.refreshToken)).toBe(false);
    expect(store.getState()).toMatchObject({ status: 'signedOut', accessToken: null, me: null });
    expect(deps.onSignedOut).toHaveBeenCalledTimes(1);
  });

  it('logout still signs out locally when the server call fails', async () => {
    const logoutRemote = jest.fn(async () => {
      throw new ApiError(0, 'NETWORK', 'down');
    });
    const { store, storage } = setup({ deps: { logoutRemote } });
    await store.getState().signIn(tokens(5), makeMe());
    await store.getState().logout();
    expect(store.getState().status).toBe('signedOut');
    expect(storage.data.has(STORAGE_KEYS.refreshToken)).toBe(false);
  });

  it('logout with an expired access token refreshes once and still revokes the server session', async () => {
    const logoutRemote = jest.fn(async (access: string) => {
      if (access === 'access-5') throw new ApiError(401, 'UNAUTHORIZED', 'expired');
    });
    const { store, storage, deps } = setup({ deps: { logoutRemote } });
    await store.getState().signIn(tokens(5), makeMe());
    await store.getState().logout();
    expect(deps.refresh).toHaveBeenCalledTimes(1);
    expect(deps.refresh).toHaveBeenCalledWith('refresh-5', expect.any(String));
    expect(logoutRemote).toHaveBeenCalledTimes(2);
    // The retry revokes with the rotated pair, so the whole refresh-token chain is ended on the server.
    expect(logoutRemote).toHaveBeenLastCalledWith('access-2', 'refresh-2');
    expect(storage.data.has(STORAGE_KEYS.refreshToken)).toBe(false);
    expect(store.getState()).toMatchObject({ status: 'signedOut', accessToken: null, me: null });
    expect(deps.onSignedOut).toHaveBeenCalledTimes(1);
  });

  it('logout does not loop when the retried revoke is also rejected', async () => {
    const logoutRemote = jest.fn(async () => {
      throw new ApiError(401, 'UNAUTHORIZED', 'expired');
    });
    const { store, storage, deps } = setup({ deps: { logoutRemote } });
    await store.getState().signIn(tokens(5), makeMe());
    await store.getState().logout();
    expect(deps.refresh).toHaveBeenCalledTimes(1);
    expect(logoutRemote).toHaveBeenCalledTimes(2);
    expect(store.getState().status).toBe('signedOut');
    expect(storage.data.has(STORAGE_KEYS.refreshToken)).toBe(false);
  });

  it('logout does not refresh on non-auth server errors', async () => {
    const logoutRemote = jest.fn(async () => {
      throw new ApiError(500, 'INTERNAL', 'boom');
    });
    const { store, deps } = setup({ deps: { logoutRemote } });
    await store.getState().signIn(tokens(5), makeMe());
    await store.getState().logout();
    expect(deps.refresh).not.toHaveBeenCalled();
    expect(logoutRemote).toHaveBeenCalledTimes(1);
    expect(store.getState().status).toBe('signedOut');
  });

  it('logout from the offline screen (no access token in memory) refreshes first, then revokes', async () => {
    let online = false;
    const refresh = jest.fn(async () => {
      if (!online) throw new ApiError(0, 'NETWORK', 'down');
      return tokens(8);
    });
    const { store, storage, deps } = setup({ refreshToken: 'refresh-1', deps: { refresh } });
    await store.getState().restore();
    expect(store.getState().status).toBe('offline');
    online = true;
    await store.getState().logout();
    expect(deps.logoutRemote).toHaveBeenCalledWith('access-8', 'refresh-8');
    expect(storage.data.has(STORAGE_KEYS.refreshToken)).toBe(false);
    expect(store.getState().status).toBe('signedOut');
  });

  it('logout while still offline signs out locally without a server call', async () => {
    const refresh = jest.fn(async () => {
      throw new ApiError(0, 'NETWORK', 'down');
    });
    const { store, storage, deps } = setup({ refreshToken: 'refresh-1', deps: { refresh } });
    await store.getState().restore();
    await store.getState().logout();
    expect(deps.logoutRemote).not.toHaveBeenCalled();
    expect(storage.data.has(STORAGE_KEYS.refreshToken)).toBe(false);
    expect(store.getState().status).toBe('signedOut');
  });

  it('logout waits for a refresh in flight and revokes with the rotated pair', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const refresh = jest.fn(async () => {
      await gate;
      return tokens(6);
    });
    const { store, storage, deps } = setup({ deps: { refresh } });
    await store.getState().signIn(tokens(5), makeMe());
    const pending = store.getState().refreshAccessToken();
    const out = store.getState().logout();
    release();
    await Promise.all([pending, out]);
    expect(deps.logoutRemote).toHaveBeenCalledWith('access-6', 'refresh-6');
    expect(storage.data.has(STORAGE_KEYS.refreshToken)).toBe(false);
    expect(store.getState().accessToken).toBeNull();
  });

  it('a refresh that resolves after the session ended never writes its tokens back', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const refresh = jest.fn(async () => {
      await gate;
      return tokens(6);
    });
    const { store, storage } = setup({ deps: { refresh } });
    await store.getState().signIn(tokens(5), makeMe());
    const pending = store.getState().refreshAccessToken();
    // An unrecoverable 401 elsewhere ends the session while the rotation is still on the wire.
    store.getState().handleAuthFailure();
    await new Promise((r) => setTimeout(r, 0));
    release();
    await expect(pending).resolves.toBe(false);
    expect(storage.data.has(STORAGE_KEYS.refreshToken)).toBe(false);
    expect(store.getState()).toMatchObject({ status: 'signedOut', accessToken: null });
  });

  it('local-only logout skips the server', async () => {
    const { store, deps } = setup();
    await store.getState().signIn(tokens(5), makeMe());
    await store.getState().logout({ remote: false });
    expect(deps.logoutRemote).not.toHaveBeenCalled();
    expect(store.getState().status).toBe('signedOut');
  });

  it('handleAuthFailure after an invalid session signs out', async () => {
    const { store, storage, deps } = setup();
    await store.getState().signIn(tokens(6), makeMe());
    store.getState().handleAuthFailure();
    await new Promise((r) => setTimeout(r, 0));
    expect(store.getState().status).toBe('signedOut');
    expect(storage.data.has(STORAGE_KEYS.refreshToken)).toBe(false);
    expect(deps.onSignedOut).toHaveBeenCalled();
  });
});
