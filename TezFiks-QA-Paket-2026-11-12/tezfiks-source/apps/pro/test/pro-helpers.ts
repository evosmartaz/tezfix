/* Router-level helpers for pro feature tests (session restore + common endpoints). */
import { route, secureStore, TOKENS, type FakeCall, type FakeRoute } from './helpers';
import { PUBLIC_CONFIG } from './fixtures';

/** Starts signed in: refresh token in SecureStore, /auth/refresh, GET /me (the current value of `getMe`), devices, public config. */
export function signedIn(getMe: () => unknown): FakeRoute[] {
  secureStore().set('tf.refreshToken', 'refresh-old');
  return [
    route('POST', '/auth/refresh', () => ({ status: 200, body: { ...TOKENS, refreshToken: 'refresh-new' } })),
    route('GET', '/me', () => ({ status: 200, body: getMe() })),
    route('POST', '/me/devices', () => ({ status: 200, body: { ok: true } })),
    route('GET', '/config/public', () => ({ status: 200, body: PUBLIC_CONFIG })),
  ];
}

/** Matches a path with a regex (dynamic ids). */
export function routeRe(method: string, re: RegExp, reply: (call: FakeCall, m: RegExpExecArray) => { status: number; body?: unknown }): FakeRoute {
  return (call) => {
    if (call.method !== method) return undefined;
    const m = re.exec(call.path);
    return m ? reply(call, m) : undefined;
  };
}

export const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export function header(call: FakeCall, name: string): string | undefined {
  const h = call.headers as Record<string, string>;
  const key = Object.keys(h).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? h[key] : undefined;
}

/**
 * The runtime (auth store, query cache) is a module singleton shared by every render in a test file: reset it between
 * router-level tests so sessions and cached queries do not leak.
 */
export async function resetApp(): Promise<void> {
  const { runtime } = require('../src/runtime') as typeof import('../src/runtime');
  const { clockStore } = require('@tezfiks/mobile') as typeof import('@tezfiks/mobile');
  const { clearPendingInvite } = require('../src/lib/invite') as typeof import('../src/lib/invite');
  const { resetMode } = require('../src/lib/mode') as typeof import('../src/lib/mode');
  const { stopOnlineTracking } = require('../src/online/tracking') as typeof import('../src/online/tracking');
  await stopOnlineTracking();
  runtime.queryClient.clear();
  runtime.auth.setState({ status: 'idle', accessToken: null, accessExpiresAt: null, me: null, lastRefreshFailure: null });
  secureStore().clear();
  clockStore.getState().reset();
  clearPendingInvite();
  resetMode();
  (require('../src/lib/entry') as typeof import('../src/lib/entry')).setEntryNext(null);
}

interface MockSocketLike {
  on: jest.Mock;
  off: jest.Mock;
  emit: jest.Mock;
}

/** Every socket created by the mocked socket.io-client `io` (oldest first). */
export function mockSockets(): MockSocketLike[] {
  return ((require('socket.io-client') as { io: jest.Mock }).io.mock.results ?? []).map((r) => r.value as MockSocketLike);
}

/** Delivers a server → client event to every listener still subscribed (on minus off) on the mocked sockets. */
export function emitServerEvent(event: string, payload: unknown): number {
  let delivered = 0;
  for (const s of mockSockets()) {
    const removed = new Set(s.off.mock.calls.filter((c) => c[0] === event).map((c) => c[1]));
    for (const [e, listener] of s.on.mock.calls as Array<[string, (p: unknown) => void]>) {
      if (e !== event || removed.has(listener)) continue;
      listener(payload);
      delivered++;
    }
  }
  return delivered;
}

/** All client → server emits of one event on the mocked sockets. */
export function clientEmits(event: string): unknown[][] {
  return mockSockets().flatMap((s) => s.emit.mock.calls.filter((c) => c[0] === event));
}
