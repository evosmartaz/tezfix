import { createApiClient, type ApiClient, type Locale } from '@tezfiks/shared';
import { apiInternalUrl, validateApiResponses } from '../env';

export interface ServerApiOptions {
  accessToken?: string | null;
  locale?: Locale;
  /** Forwarded so the API rate-limits and audits by the real browser address. */
  forwardedFor?: string | null;
  userAgent?: string | null;
}

/**
 * Server-to-server client (BFF). No refresh handling here: the proxy refreshes before rendering, and a 401 means the
 * session ended (callers redirect to login).
 */
export function createServerApi(opts: ServerApiOptions = {}): ApiClient {
  return createApiClient({
    baseUrl: apiInternalUrl(),
    getAccessToken: () => opts.accessToken ?? null,
    getLocale: opts.locale ? () => opts.locale as Locale : undefined,
    validateResponses: validateApiResponses(),
    timeoutMs: 15_000,
    headers: () => {
      const h: Record<string, string> = {};
      if (opts.forwardedFor) h['X-Forwarded-For'] = opts.forwardedFor;
      if (opts.userAgent) h['User-Agent'] = opts.userAgent;
      return h;
    },
  });
}
