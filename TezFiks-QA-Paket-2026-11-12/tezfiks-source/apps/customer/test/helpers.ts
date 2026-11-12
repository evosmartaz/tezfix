/* Shared helpers for router-level tests: a fake API behind global fetch. */

export const API = 'http://10.0.2.2:3000/tezfix/api';

export interface FakeCall {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

export type FakeRoute = (call: FakeCall) => { status: number; body?: unknown } | undefined;

/** Installs a fetch mock. Routes are tried in order; unmatched requests return 404. */
export function installFakeApi(routes: FakeRoute[]): FakeCall[] {
  const calls: FakeCall[] = [];
  global.fetch = jest.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const call: FakeCall = {
      method: String(init.method ?? 'GET'),
      path: url.startsWith(API) ? url.slice(API.length) : url,
      headers: (init.headers ?? {}) as Record<string, string>,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    for (const r of routes) {
      const res = r(call);
      if (res) return new Response(res.body === undefined ? null : JSON.stringify(res.body), { status: res.status, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'not found' } }), { status: 404 });
  }) as unknown as typeof fetch;
  return calls;
}

export function route(method: string, path: string, reply: (call: FakeCall) => { status: number; body?: unknown }): FakeRoute {
  return (call) => (call.method === method && call.path === path ? reply(call) : undefined);
}

export const TOKENS = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  accessExpiresAt: '2026-10-25T10:15:00.000Z',
  refreshExpiresAt: '2026-11-24T10:00:00.000Z',
};

export function me(over: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    phone: '+994501234567',
    firstName: 'Nizami',
    lastName: 'Tağızadə',
    photo: null,
    locale: 'az',
    status: 'ACTIVE',
    createdAt: '2026-10-25T10:00:00.000Z',
    profileComplete: true,
    customer: null,
    handyman: null,
    companies: [],
    ...over,
  };
}

export function secureStore(): Map<string, string> {
  return (require('expo-secure-store') as { __store: Map<string, string> }).__store;
}
