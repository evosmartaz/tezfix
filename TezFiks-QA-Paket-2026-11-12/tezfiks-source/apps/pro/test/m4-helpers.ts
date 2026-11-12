/* Router-level helpers for lane M4 tests: a small stateful fake of the pro/company endpoints. */
import { act } from 'expo-router/testing-library';
import type { ProAssignment, ProProfile, ProProfileResponse } from '@tezfiks/shared';
import { installFakeApi, me, route, type FakeCall, type FakeRoute } from './helpers';
import { routeRe, signedIn, UUID } from './pro-helpers';
import { profileResponse, proProfile } from './fixtures';

export const SOLO_ME = { id: UUID(1), kind: 'SOLO', status: 'APPROVED', companyId: null, isOnline: false };
export const WORKER_ME = { id: UUID(1), kind: 'COMPANY_WORKER', status: 'APPROVED', companyId: UUID(9), isOnline: false };

export type Reply = { status: number; body?: unknown };

export interface ProWorld {
  profile: ProProfileResponse;
  assignments: Record<string, ProAssignment>;
  calls: FakeCall[];
}

export function ok(body: unknown): Reply {
  return { status: 200, body };
}

export function apiError(status: number, code: string, details: unknown = null): Reply {
  return { status, body: { error: { code, message: code, details } } };
}

/** Path without the query string, and the parsed query. */
export function splitPath(path: string): { path: string; query: Record<string, string> } {
  const [p, q = ''] = path.split('?');
  const query: Record<string, string> = {};
  for (const part of q.split('&')) {
    if (!part) continue;
    const [k, v = ''] = part.split('=');
    query[decodeURIComponent(k!)] = decodeURIComponent(v);
  }
  return { path: p!, query };
}

/** Matches by method and path (query string ignored). */
export function on(method: string, path: string | RegExp, reply: (call: FakeCall, m: RegExpExecArray | null, query: Record<string, string>) => Reply): FakeRoute {
  return (call) => {
    if (call.method !== method) return undefined;
    const { path: p, query } = splitPath(call.path);
    if (typeof path === 'string') return p === path ? reply(call, null, query) : undefined;
    const m = path.exec(p);
    return m ? reply(call, m, query) : undefined;
  };
}

/**
 * Installs a signed-in pro with a profile, its assignments (GET list/detail) and any extra routes (tried first).
 * Returns the mutable world so tests can change server state between steps.
 */
export function installPro(opts: {
  me?: Record<string, unknown>;
  profile?: ProProfile | null;
  managedCompanies?: ProProfileResponse['managedCompanies'];
  assignments?: ProAssignment[];
  routes?: FakeRoute[];
}): ProWorld {
  const world: ProWorld = {
    profile: profileResponse({ profile: opts.profile === undefined ? proProfile() : opts.profile, managedCompanies: opts.managedCompanies ?? [] }),
    assignments: Object.fromEntries((opts.assignments ?? []).map((a) => [a.id, a])),
    calls: [],
  };
  const current = me({ firstName: 'Elvin', lastName: 'Məmmədov', handyman: SOLO_ME, ...(opts.me ?? {}) });
  const active = new Set(['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'PRICE_PROPOSED', 'PRICE_DISPUTED']);
  world.calls = installFakeApi([
    ...(opts.routes ?? []),
    ...signedIn(() => current),
    route('GET', '/pro/profile', () => ok(world.profile)),
    on('GET', '/pro/stats/today', () => ok({ date: '2026-10-25', jobs: 5, earnings: 12000, fees: 5000 })),
    on('GET', '/notifications/unread-count', () => ok({ count: 0 })),
    on('GET', '/pro/assignments', (_c, _m, q) => {
      const items = Object.values(world.assignments).filter((a) => (q.scope === 'history' ? !active.has(a.status) : active.has(a.status)));
      return ok({ items, nextCursor: null });
    }),
    on('GET', /^\/pro\/assignments\/([^/]+)$/, (_c, m) => {
      const a = world.assignments[m![1]!];
      return a ? ok(a) : apiError(404, 'NOT_FOUND');
    }),
  ]);
  return world;
}

/** Lets pending promises and timers settle under expo-router's fake timers. */
export async function settle(ms = 50): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}
