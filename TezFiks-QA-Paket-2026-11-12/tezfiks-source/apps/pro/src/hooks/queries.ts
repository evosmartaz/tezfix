import { useEffect, useRef } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@tezfiks/shared';
import { useApi, useAuth, useRuntime, useSocketEvent, useT } from '@tezfiks/mobile';

export type JobScope = 'active' | 'history';

export const qk = {
  profile: ['pro', 'profile'] as const,
  config: ['config', 'public'] as const,
  categories: ['categories', 'all'] as const,
  statsToday: ['pro', 'stats', 'today'] as const,
  offers: ['pro', 'offers', 'current'] as const,
  scheduled: ['pro', 'offers', 'scheduled'] as const,
  kycStatus: (companyId: string | null) => ['kyc', 'status', companyId ?? 'self'] as const,
  company: (companyId: string) => ['company', companyId] as const,
  invite: (token: string) => ['invites', token] as const,
  assignment: (id: string) => ['pro', 'assignment', id] as const,
  assignments: (scope: 'active' | 'history') => ['pro', 'assignments', scope] as const,
  companyDashboard: (companyId: string) => ['company', companyId, 'dashboard'] as const,
  companyOffers: (companyId: string) => ['company', companyId, 'offers'] as const,
  companyAssignments: (companyId: string, scope: 'active' | 'history') => ['company', companyId, 'assignments', scope] as const,
  companyAssignment: (companyId: string, id: string) => ['company', companyId, 'assignment', id] as const,
  members: (companyId: string) => ['company', companyId, 'members'] as const,
  invites: (companyId: string) => ['company', companyId, 'invites'] as const,
  /** Wallet of the handyman (companyId null) or of a company. */
  wallet: (companyId: string | null) => ['wallet', companyId ?? 'self'] as const,
  walletTx: (companyId: string | null) => ['wallet', companyId ?? 'self', 'transactions'] as const,
  earnings: (companyId: string | null) => ['earnings', companyId ?? 'self'] as const,
  payoutMethod: (companyId: string | null) => ['earnings', companyId ?? 'self', 'method'] as const,
  payment: (id: string) => ['payments', id] as const,
  projectsOpen: (companyId: string | null) => ['projects', companyId ?? 'self', 'open'] as const,
  projectsMine: (companyId: string | null) => ['projects', companyId ?? 'self', 'mine'] as const,
  project: (id: string, companyId: string | null) => ['projects', companyId ?? 'self', 'detail', id] as const,
  notifications: ['notifications'] as const,
  unread: ['notifications', 'unread'] as const,
  chat: (assignmentId: string) => ['chat', assignmentId] as const,
};

/** GET /pro/profile: own handyman profile (or null) and managed companies. */
export function useProProfile() {
  const client = useApi();
  const signedIn = useAuth((s) => s.status === 'signedIn');
  return useQuery({ queryKey: qk.profile, queryFn: () => client.call(api.pro.profile), enabled: signedIn });
}

/** GET /config/public: request fee, low balance threshold, demo flag. */
export function usePublicConfig() {
  const client = useApi();
  return useQuery({ queryKey: qk.config, queryFn: () => client.call(api.health.config), staleTime: 10 * 60_000 });
}

/** Active categories (groups + services) for the trade pickers. */
export function useCategories() {
  const client = useApi();
  return useQuery({ queryKey: qk.categories, queryFn: () => client.call(api.categories.list, { query: {} }), staleTime: 10 * 60_000 });
}

/**
 * Paginated job list: personal (GET /pro/assignments) or company (GET /company/:id/assignments).
 * The ONLY reader of qk.assignments / qk.companyAssignments: every screen that needs these jobs (the orders list,
 * the home "active job" shortcut) goes through this hook, so the cache entry always has the infinite shape
 * `{ pages, pageParams }`. A plain useQuery on the same key would store a single Page and crash the other reader.
 */
export function useJobPages(scope: JobScope, companyId: string | null, opts: { refetchInterval?: number } = {}) {
  const client = useApi();
  return useInfiniteQuery({
    queryKey: companyId ? qk.companyAssignments(companyId, scope) : qk.assignments(scope),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      companyId
        ? client.call(api.company.assignments, { params: { companyId }, query: { scope, limit: 20, ...(pageParam ? { cursor: pageParam } : {}) } })
        : client.call(api.pro.assignments, { query: { scope, limit: 20, ...(pageParam ? { cursor: pageParam } : {}) } }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    ...(opts.refetchInterval ? { refetchInterval: opts.refetchInterval } : {}),
  });
}

/** Reloads `me` into the auth store (after onboarding, invite accept, approval). */
export function useRefreshMe() {
  const runtime = useRuntime();
  return async () => {
    const me = await runtime.api.call(api.me.get);
    runtime.auth.getState().setMe(me);
    return me;
  };
}

/**
 * Server pushes that change the pro profile: approval/rejection/block (`profile:updated`) and wallet changes
 * (`wallet:updated`). Refetches the profile and `me` so the gates and the home follow.
 */
export function useProfileRealtime(): void {
  const queryClient = useQueryClient();
  const refreshMe = useRefreshMe();
  useSocketEvent('profile:updated', () => {
    void queryClient.invalidateQueries({ queryKey: qk.profile });
    void queryClient.invalidateQueries({ queryKey: ['kyc'] });
    void refreshMe().catch(() => undefined);
  });
  useSocketEvent('wallet:updated', () => {
    void queryClient.invalidateQueries({ queryKey: qk.profile });
    void queryClient.invalidateQueries({ queryKey: ['company'] });
  });
}

/**
 * Job, wallet and notification pushes (lane M4). Payloads are invalidation hints: the screens refetch over REST.
 * Mounted once in the root layout.
 */
export function useJobsRealtime(): void {
  const queryClient = useQueryClient();
  const jobs = () => {
    void queryClient.invalidateQueries({ queryKey: ['pro', 'assignment'] });
    void queryClient.invalidateQueries({ queryKey: ['pro', 'assignments'] });
    void queryClient.invalidateQueries({ queryKey: ['company'] });
    void queryClient.invalidateQueries({ queryKey: qk.statsToday });
  };
  useSocketEvent('assignment:updated', jobs);
  useSocketEvent('assignment:contact', jobs);
  useSocketEvent('wallet:updated', () => {
    void queryClient.invalidateQueries({ queryKey: ['wallet'] });
    void queryClient.invalidateQueries({ queryKey: ['earnings'] });
  });
  useSocketEvent('payment:updated', (p) => {
    void queryClient.invalidateQueries({ queryKey: qk.payment(p.paymentIntentId) });
    void queryClient.invalidateQueries({ queryKey: ['wallet'] });
  });
  useSocketEvent('notification:new', () => {
    void queryClient.invalidateQueries({ queryKey: qk.notifications });
  });
  useSocketEvent('company:workers', (p) => {
    void queryClient.invalidateQueries({ queryKey: ['company', p.companyId] });
  });
}

/** Unread notifications badge (GET /notifications/unread-count). */
export function useUnreadCount() {
  const client = useApi();
  const signedIn = useAuth((s) => s.status === 'signedIn');
  return useQuery({ queryKey: qk.unread, queryFn: () => client.call(api.notifications.unreadCount), enabled: signedIn, refetchInterval: 60_000 });
}

/**
 * BUG-005: the API answers in the language of the Accept-Language header (trade and category names, job titles), and
 * the query keys do not carry the language, so after a language change the cache kept the old texts. On a change of the
 * UI language this refetches only the queries whose data is localized by the server (not wallet, chat, etc.).
 */
export function useLocaleRefetch(): void {
  const queryClient = useQueryClient();
  const { locale } = useT();
  const last = useRef(locale);
  useEffect(() => {
    if (last.current === locale) return;
    last.current = locale;
    for (const queryKey of [qk.profile, qk.categories, ['pro', 'assignment'], ['pro', 'assignments'], ['pro', 'offers'], ['company'], ['projects'], ['invites'], qk.notifications]) {
      void queryClient.invalidateQueries({ queryKey });
    }
  }, [locale, queryClient]);
}
