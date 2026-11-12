import { vi } from 'vitest';
import type { AdminMe, AuthTokens, Me } from '@tezfiks/shared';

export const API = 'http://api.test/tezfix/api';

export const IDS = {
  user: '11111111-1111-4111-8111-111111111111',
  admin: '22222222-2222-4222-8222-222222222222',
  companyA: '33333333-3333-4333-8333-333333333333',
  companyB: '44444444-4444-4444-8444-444444444444',
  challenge: '55555555-5555-4555-8555-555555555555',
};

function b64url(value: string): string {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Unsigned JWT-shaped token with the given `exp` (seconds since epoch). The panel only reads `exp`. */
export function makeJwt(expSec: number, extra: Record<string, unknown> = {}): string {
  return `${b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64url(JSON.stringify({ sub: IDS.user, exp: expSec, ...extra }))}.sig`;
}

export function makeTokens(nowMs = Date.now(), label = 'a'): AuthTokens {
  return {
    accessToken: makeJwt(Math.floor(nowMs / 1000) + 900, { label }),
    refreshToken: `refresh-${label}-${'x'.repeat(24)}`,
    accessExpiresAt: new Date(nowMs + 900_000).toISOString(),
    refreshExpiresAt: new Date(nowMs + 30 * 86_400_000).toISOString(),
  };
}

export const adminFixture: AdminMe = {
  id: IDS.admin,
  email: 'admin@tezfiks.az',
  name: 'Aysel Admin',
  role: 'ADMIN',
};

export function meFixture(companies: Me['companies'] = []): Me {
  return {
    id: IDS.user,
    phone: '+994501234567',
    firstName: 'Elvin',
    lastName: 'Məmmədov',
    photo: null,
    locale: 'az',
    status: 'ACTIVE',
    createdAt: '2026-10-01T08:00:00.000Z',
    profileComplete: true,
    customer: null,
    handyman: null,
    companies,
  };
}

export function membership(
  companyId: string,
  role: 'MANAGER' | 'WORKER',
  companyName = 'Usta Servis MMC',
): Me['companies'][number] {
  return { companyId, companyName, role, companyStatus: 'APPROVED' };
}

export interface RecordedCall {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

export type ApiHandler = (
  call: RecordedCall,
) => { status: number; body?: unknown } | Promise<{ status: number; body?: unknown }>;

/** Stubs global fetch for the API base URL. Handlers are keyed by "METHOD /path". Unhandled calls return 404. */
export function mockApi(handlers: Record<string, ApiHandler>) {
  const calls: RecordedCall[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = url.pathname.replace('/tezfix/api', '');
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    const call: RecordedCall = { method, path, headers, body };
    calls.push(call);
    const handler = handlers[`${method} ${path}`];
    if (!handler) {
      return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found' } }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }
    const out = await handler(call);
    return new Response(out.body === undefined ? null : JSON.stringify(out.body), {
      status: out.status,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

export function apiError(status: number, code: string, message = code) {
  return { status, body: { error: { code, message } } };
}

/** In-memory replacement for `cookies()` from next/headers. */
export function createCookieJar(initial: Record<string, string> = {}) {
  const values = new Map<string, { value: string; options?: Record<string, unknown> }>();
  for (const [k, v] of Object.entries(initial)) values.set(k, { value: v });
  const store = {
    get: (name: string) => (values.has(name) ? { name, value: values.get(name)!.value } : undefined),
    getAll: () => [...values.entries()].map(([name, v]) => ({ name, value: v.value })),
    has: (name: string) => values.has(name),
    set: (name: string, value: string, options?: Record<string, unknown>) => {
      values.set(name, { value, options });
    },
    delete: (name: string) => values.delete(name),
  };
  return { store, values };
}

/** Error thrown by the mocked `redirect()` / `notFound()` (same digest prefix as Next.js). */
export class NavigationThrow extends Error {
  constructor(
    public readonly digest: string,
    public readonly location?: string,
  ) {
    super(digest);
  }
}
