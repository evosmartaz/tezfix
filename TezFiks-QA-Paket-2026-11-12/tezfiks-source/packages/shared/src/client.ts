import type { CallOptions, Endpoint, EndpointInput, EndpointOutput } from './contract/define';
import { ApiError, ApiErrorBodySchema } from './errors';
import type { Locale } from './enums';

export interface ApiClientOptions {
  /** Absolute API base including the prefix, e.g. "https://evosmart.az/tezfix/api". */
  baseUrl: string;
  getAccessToken?: () => string | null | undefined | Promise<string | null | undefined>;
  /** Called once after a 401 on an authenticated endpoint. Return true when a new access token is available. */
  refreshAccessToken?: () => Promise<boolean>;
  /** Called when refresh fails or is unavailable after a 401. */
  onAuthFailure?: () => void;
  getLocale?: () => Locale;
  fetch?: typeof fetch;
  /** Parse responses with the endpoint schema (development). */
  validateResponses?: boolean;
  newIdempotencyKey?: () => string;
  timeoutMs?: number;
  headers?: () => Record<string, string>;
}

export type CallArgs<E extends Endpoint> = {} extends EndpointInput<E> ? [input?: EndpointInput<E>] : [input: EndpointInput<E>];

export function buildPath(path: string, params?: Record<string, unknown>): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, (_m, name: string) => {
    const value = params?.[name];
    if (value === undefined || value === null || value === '') throw new Error(`Missing path param "${name}" for ${path}`);
    return encodeURIComponent(String(value));
  });
}

export function buildQuery(query?: Record<string, unknown>): string {
  if (!query) return '';
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    const values = Array.isArray(value) ? value : [value];
    for (const v of values) parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

function defaultKey(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export function createApiClient(opts: ApiClientOptions) {
  const base = opts.baseUrl.replace(/\/+$/, '');
  const doFetch = opts.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  function url<E extends Endpoint>(endpoint: E, input?: Partial<EndpointInput<E>>): string {
    const i = (input ?? {}) as { params?: Record<string, unknown>; query?: Record<string, unknown> };
    return base + buildPath(endpoint.path, i.params) + buildQuery(i.query);
  }

  async function send(endpoint: Endpoint, input: Record<string, unknown>, idemKey: string | undefined): Promise<Response> {
    const callOpts = input as CallOptions & { body?: unknown; formData?: FormData };
    const headers: Record<string, string> = { Accept: 'application/json', ...(opts.headers?.() ?? {}), ...(callOpts.headers ?? {}) };
    const locale = opts.getLocale?.();
    if (locale) headers['Accept-Language'] = locale;
    if (endpoint.auth !== 'none') {
      const token = await opts.getAccessToken?.();
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    if (idemKey) headers['Idempotency-Key'] = idemKey;
    let body: BodyInit | undefined;
    if (endpoint.multipart) {
      body = callOpts.formData;
    } else if (callOpts.body !== undefined && endpoint.method !== 'GET') {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(callOpts.body);
    } else if (endpoint.method !== 'GET' && endpoint.method !== 'DELETE' && endpoint.body) {
      headers['Content-Type'] = 'application/json';
      body = '{}';
    }
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
    const timeout = opts.timeoutMs ?? 30_000;
    const timer = controller ? setTimeout(() => controller.abort(), timeout) : undefined;
    const onAbort = () => controller?.abort();
    callOpts.signal?.addEventListener?.('abort', onAbort);
    try {
      return await doFetch(url(endpoint, input as never), {
        method: endpoint.method,
        headers,
        body,
        signal: controller?.signal,
      });
    } catch (err) {
      const aborted = controller?.signal.aborted;
      throw new ApiError(0, aborted ? 'TIMEOUT' : 'NETWORK', err instanceof Error ? err.message : String(err));
    } finally {
      if (timer) clearTimeout(timer);
      callOpts.signal?.removeEventListener?.('abort', onAbort);
    }
  }

  async function toError(res: Response): Promise<ApiError> {
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      json = undefined;
    }
    const parsed = ApiErrorBodySchema.safeParse(json);
    if (parsed.success) {
      return new ApiError(res.status, parsed.data.error.code, parsed.data.error.message, parsed.data.error.details);
    }
    return new ApiError(res.status, `HTTP_${res.status}`, res.statusText || `HTTP ${res.status}`);
  }

  async function call<E extends Endpoint>(endpoint: E, ...args: CallArgs<E>): Promise<EndpointOutput<E>> {
    const input = (args[0] ?? {}) as Record<string, unknown> & CallOptions;
    const idemKey = endpoint.idempotent ? input.idempotencyKey ?? (opts.newIdempotencyKey ?? defaultKey)() : undefined;
    let res = await send(endpoint, input, idemKey);
    if (res.status === 401 && endpoint.auth !== 'none') {
      const refreshed = opts.refreshAccessToken ? await opts.refreshAccessToken().catch(() => false) : false;
      if (refreshed) res = await send(endpoint, input, idemKey);
      if (res.status === 401) opts.onAuthFailure?.();
    }
    if (!res.ok) throw await toError(res);
    if (res.status === 204) return undefined as EndpointOutput<E>;
    if (endpoint.raw) return (await res.text()) as EndpointOutput<E>;
    const json: unknown = await res.json();
    if (opts.validateResponses) {
      const parsed = endpoint.response.safeParse(json);
      if (!parsed.success) {
        throw new ApiError(res.status, 'CONTRACT_MISMATCH', `Response of ${endpoint.method} ${endpoint.path} does not match the contract`, parsed.error.issues);
      }
      return parsed.data as EndpointOutput<E>;
    }
    return json as EndpointOutput<E>;
  }

  return { call, url, baseUrl: base };
}

export type ApiClient = ReturnType<typeof createApiClient>;
