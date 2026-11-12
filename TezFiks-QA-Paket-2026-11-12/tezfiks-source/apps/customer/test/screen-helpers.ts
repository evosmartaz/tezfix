/* Router-level helpers: a signed-in customer session and a fake API with path patterns and query strings. */
import { act } from '@testing-library/react-native';
import { API, me, secureStore, type FakeCall } from './helpers';
import { PUBLIC_CONFIG, account, categories } from './fixtures';

export interface Call extends FakeCall {
  /** Path without the query string. */
  pathname: string;
  query: Record<string, string>;
  formData: FormData | null;
}

export type Reply = { status: number; body?: unknown } | undefined;
export type Handler = (call: Call) => Reply;

/** `on('GET', '/requests/:id', ...)`: `:param` segments match one path segment; the query string is ignored. */
export function on(method: string, pattern: string, reply: (call: Call, params: Record<string, string>) => Reply | { status: number; body?: unknown }): Handler {
  const names: string[] = [];
  const re = new RegExp(
    '^' +
      pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\/:([a-zA-Z]+)/g, (_m, n: string) => {
        names.push(n);
        return '/([^/]+)';
      }) +
      '$',
  );
  return (call) => {
    if (call.method !== method) return undefined;
    const m = re.exec(call.pathname);
    if (!m) return undefined;
    const params: Record<string, string> = {};
    names.forEach((n, i) => (params[n] = decodeURIComponent(m[i + 1])));
    return reply(call, params);
  };
}

export const ok = (body: unknown) => ({ status: 200, body });
export const fail = (status: number, code: string, details: unknown = null) => ({ status, body: { error: { code, message: code, details } } });

/** Installs a fetch mock; later handlers passed to `use` take precedence over the defaults. */
export function fakeApi(handlers: Handler[]) {
  const calls: Call[] = [];
  let list = [...handlers];
  global.fetch = jest.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const path = url.startsWith(API) ? url.slice(API.length) : url;
    const [pathname, qs = ''] = path.split('?');
    const query: Record<string, string> = {};
    for (const part of qs.split('&').filter(Boolean)) {
      const [k, v = ''] = part.split('=');
      query[decodeURIComponent(k)] = decodeURIComponent(v);
    }
    const call: Call = {
      method: String(init.method ?? 'GET'),
      path,
      pathname,
      query,
      headers: (init.headers ?? {}) as Record<string, string>,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
      formData: init.body && typeof init.body !== 'string' ? (init.body as FormData) : null,
    };
    calls.push(call);
    for (const h of list) {
      const res = h(call);
      if (res) return new Response(res.body === undefined ? null : JSON.stringify(res.body), { status: res.status, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'not found' } }), { status: 404 });
  }) as unknown as typeof fetch;
  return {
    calls,
    use(...more: Handler[]) {
      list = [...more, ...list];
    },
    find(method: string, pathname: string | RegExp) {
      return calls.filter((c) => c.method === method && (typeof pathname === 'string' ? c.pathname === pathname : pathname.test(c.pathname)));
    },
  };
}

/** A saved session for an existing customer plus the common read endpoints. */
export function signedInCustomer(opts: { customerType?: 'INDIVIDUAL' | 'COMPANY'; extra?: Handler[]; account?: ReturnType<typeof account> } = {}) {
  secureStore().set('tf.refreshToken', 'refresh-old');
  const type = opts.customerType ?? 'INDIVIDUAL';
  const acc = opts.account ?? account({ type, companyName: type === 'COMPANY' ? 'Kontur MMC' : null, voen: type === 'COMPANY' ? '1234567890' : null });
  return fakeApi([
    ...(opts.extra ?? []),
    on('POST', '/auth/refresh', () =>
      ok({ accessToken: 'access-2', refreshToken: 'refresh-new', accessExpiresAt: '2026-10-25T10:15:00.000Z', refreshExpiresAt: '2026-11-24T10:00:00.000Z' }),
    ),
    on('GET', '/me', () => ok(me({ customer: { id: acc.id, type, companyName: acc.companyName } }))),
    on('POST', '/me/devices', () => ok({ ok: true })),
    on('GET', '/categories', () => ok({ items: categories() })),
    on('GET', '/config/public', () => ok(PUBLIC_CONFIG)),
    on('GET', '/customer/account', () => ok({ account: acc })),
    on('GET', '/customer/addresses', () => ok({ items: [] })),
    on('GET', '/requests', () => ok({ items: [], nextCursor: null })),
  ]);
}

/**
 * Lets pending promises settle and moves the clock by `ms` inside act(). renderRouter installs jest fake timers,
 * so real waiting would never fire them.
 */
export async function flush(ms = 0): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
    jest.advanceTimersByTime(ms);
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

/** The socket created by the SocketProvider (socket.io-client is mocked in setup.ts). */
export function lastSocket(): { on: jest.Mock; off: jest.Mock; emit: jest.Mock } | null {
  const io = (require('socket.io-client') as { io: jest.Mock }).io;
  const results = io.mock.results;
  return results.length ? (results[results.length - 1].value as { on: jest.Mock; off: jest.Mock; emit: jest.Mock }) : null;
}

/** Calls every listener registered for a socket event (as the server would). */
export async function serverEmit(event: string, payload: unknown): Promise<void> {
  const socket = lastSocket();
  if (!socket) throw new Error('no socket');
  const listeners = socket.on.mock.calls.filter((c) => c[0] === event).map((c) => c[1] as (p: unknown) => void);
  const removed = new Set(socket.off.mock.calls.filter((c) => c[0] === event).map((c) => c[1]));
  await act(async () => {
    for (const l of listeners) if (!removed.has(l)) l(payload);
  });
}

/** Fresh session/cache between router tests in one file (the runtime is a process singleton). */
export function resetApp(): void {
  const { runtime } = require('../src/runtime') as typeof import('../src/runtime');
  runtime.auth.setState({ status: 'idle', accessToken: null, accessExpiresAt: null, me: null, lastRefreshFailure: null });
  runtime.queryClient.clear();
  secureStore().clear();
  const io = (require('socket.io-client') as { io: jest.Mock }).io;
  io.mockClear();
}
