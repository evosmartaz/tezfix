import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type CustomerAssignment, type EndpointOutput } from '@tezfiks/shared';
import { useApi, useAuth, useSocketEvent, useT } from '@tezfiks/mobile';
import { FALLBACK_TIMING_CONFIG, type TimingConfig } from '../lib/timing';

export type PublicConfig = EndpointOutput<typeof api.health.config>;
export type RequestScope = 'active' | 'history';

/** React Query keys of the customer app. */
export const qk = {
  config: ['config'] as const,
  categories: (locale: string) => ['categories', locale] as const,
  account: ['customer', 'account'] as const,
  addresses: ['customer', 'addresses'] as const,
  requestsRoot: ['requests'] as const,
  requests: (scope: RequestScope) => ['requests', scope] as const,
  request: (id: string) => ['request', id] as const,
  reverse: (lat: number, lng: number, locale: string) => ['geo', 'reverse', lat.toFixed(4), lng.toFixed(4), locale] as const,
  assignmentRoot: ['assignment'] as const,
  assignment: (id: string) => ['assignment', id] as const,
  chat: (assignmentId: string) => ['chat', assignmentId] as const,
  wallet: ['wallet'] as const,
  walletTx: ['wallet', 'transactions'] as const,
  payment: (id: string) => ['payment', id] as const,
  notificationsRoot: ['notifications'] as const,
  notifications: ['notifications', 'list'] as const,
  unread: ['notifications', 'unread'] as const,
  projectsRoot: ['projects'] as const,
  projects: (scope: RequestScope) => ['projects', scope] as const,
  project: (id: string) => ['project', id] as const,
  cases: ['cases'] as const,
};

/** GET /config/public (fees, timers, feature flags). */
export function usePublicConfig() {
  const client = useApi();
  return useQuery({ queryKey: qk.config, queryFn: () => client.call(api.health.config), staleTime: 5 * 60_000 });
}

/** The request-form subset of the public config, with spec defaults until it has loaded. */
export function useTimingConfig(): TimingConfig {
  const { data } = usePublicConfig();
  if (!data) return FALLBACK_TIMING_CONFIG;
  return {
    emergencyFeePerSlot: data.emergencyFeePerSlot,
    maxSlots: data.maxSlots,
    maxPhotos: data.maxPhotos,
    scheduledMinLeadMin: data.scheduledMinLeadMin,
    scheduledMaxLeadDays: data.scheduledMaxLeadDays,
  };
}

/** All active categories (groups + services) in the UI language. */
export function useCategories() {
  const client = useApi();
  const { locale } = useT();
  return useQuery({
    queryKey: qk.categories(locale),
    queryFn: async () => (await client.call(api.categories.list, { query: {} })).items,
    staleTime: 10 * 60_000,
  });
}

/** The caller's customer account with its wallet summary. */
export function useCustomerAccount() {
  const client = useApi();
  const signedIn = useAuth((s) => s.status === 'signedIn');
  return useQuery({
    queryKey: qk.account,
    queryFn: async () => (await client.call(api.customer.getAccount)).account,
    enabled: signedIn,
  });
}

export function useSavedAddresses(enabled = true) {
  const client = useApi();
  return useQuery({
    queryKey: qk.addresses,
    queryFn: async () => (await client.call(api.customer.listAddresses)).items,
    enabled,
  });
}

export const REQUESTS_PAGE_SIZE = 20;

export function useRequestList(scope: RequestScope) {
  const client = useApi();
  return useInfiniteQuery({
    queryKey: qk.requests(scope),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => client.call(api.requests.list, { query: { scope, cursor: pageParam, limit: REQUESTS_PAGE_SIZE } }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** One request; polls while it is searching so the screen recovers if a socket event was missed. */
export function useRequest(id: string | undefined, opts: { pollMs?: number } = {}) {
  const client = useApi();
  return useQuery({
    queryKey: qk.request(id ?? ''),
    queryFn: () => client.call(api.requests.get, { params: { id: id as string } }),
    enabled: !!id,
    refetchInterval: opts.pollMs ?? false,
  });
}

/**
 * Socket → cache invalidation for the customer app (server events are hints; REST is the truth):
 * request and assignment changes refresh the request lists and details, wallet changes the account.
 */
export function useCustomerRealtime(): void {
  const queryClient = useQueryClient();
  useSocketEvent('request:updated', (p) => {
    void queryClient.invalidateQueries({ queryKey: qk.requestsRoot });
    void queryClient.invalidateQueries({ queryKey: qk.request(p.requestId) });
  });
  useSocketEvent('assignment:updated', (p) => {
    void queryClient.invalidateQueries({ queryKey: qk.requestsRoot });
    void queryClient.invalidateQueries({ queryKey: qk.request(p.requestId) });
    void queryClient.invalidateQueries({ queryKey: qk.assignment(p.assignmentId) });
  });
  useSocketEvent('assignment:contact', (p) => {
    void queryClient.invalidateQueries({ queryKey: qk.assignment(p.assignmentId) });
  });
  useSocketEvent('wallet:updated', () => {
    void queryClient.invalidateQueries({ queryKey: qk.account });
    void queryClient.invalidateQueries({ queryKey: qk.wallet });
  });
  useSocketEvent('payment:updated', (p) => {
    void queryClient.invalidateQueries({ queryKey: qk.payment(p.paymentIntentId) });
    if (p.purpose === 'JOB_PAYMENT' || p.purpose === 'TIP') {
      void queryClient.invalidateQueries({ queryKey: qk.assignmentRoot });
      void queryClient.invalidateQueries({ queryKey: qk.requestsRoot });
    }
    if (p.purpose === 'WALLET_TOPUP') void queryClient.invalidateQueries({ queryKey: qk.wallet });
  });
  useSocketEvent('notification:new', () => {
    void queryClient.invalidateQueries({ queryKey: qk.notificationsRoot });
  });
}

/** One assignment from the customer's side (tracking, payment, tip, rating). */
export function useAssignment(
  id: string | undefined,
  opts: { pollMs?: number | false | ((a: CustomerAssignment | undefined) => number | false) } = {},
) {
  const client = useApi();
  return useQuery({
    queryKey: qk.assignment(id ?? ''),
    queryFn: () => client.call(api.assignments.get, { params: { id: id as string } }),
    enabled: !!id,
    refetchInterval: (query) => {
      const poll = opts.pollMs ?? false;
      return typeof poll === 'function' ? poll(query.state.data) : poll;
    },
  });
}

/** Own customer wallet (GET /wallet). */
export function useWallet() {
  const client = useApi();
  const signedIn = useAuth((s) => s.status === 'signedIn');
  return useQuery({ queryKey: qk.wallet, queryFn: () => client.call(api.wallet.get, { query: {} }), enabled: signedIn });
}

export const WALLET_TX_PAGE_SIZE = 20;

export function useWalletTransactions() {
  const client = useApi();
  return useInfiniteQuery({
    queryKey: qk.walletTx,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => client.call(api.wallet.transactions, { query: { cursor: pageParam, limit: WALLET_TX_PAGE_SIZE } }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useNotifications() {
  const client = useApi();
  return useInfiniteQuery({
    queryKey: qk.notifications,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => client.call(api.notifications.list, { query: { cursor: pageParam, limit: 30 } }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** Unread notifications for the bell badge (refreshed by `notification:new`). */
export function useUnreadCount() {
  const client = useApi();
  const signedIn = useAuth((s) => s.status === 'signedIn');
  return useQuery({
    queryKey: qk.unread,
    queryFn: async () => (await client.call(api.notifications.unreadCount)).count,
    enabled: signedIn,
    staleTime: 30_000,
  });
}

export function useProjectList(scope: RequestScope) {
  const client = useApi();
  return useInfiniteQuery({
    queryKey: qk.projects(scope),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => client.call(api.projects.list, { query: { scope, cursor: pageParam, limit: 20 } }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useProject(id: string | undefined) {
  const client = useApi();
  return useQuery({
    queryKey: qk.project(id ?? ''),
    queryFn: () => client.call(api.projects.get, { params: { id: id as string } }),
    enabled: !!id,
  });
}

export function useCases() {
  const client = useApi();
  return useInfiniteQuery({
    queryKey: qk.cases,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => client.call(api.cases.list, { query: { cursor: pageParam, limit: 20 } }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}
