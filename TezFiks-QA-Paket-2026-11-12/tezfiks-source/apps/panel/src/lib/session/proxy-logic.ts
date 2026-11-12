/**
 * Proxy (Next 16 middleware) logic, kept free of `next/server` globals so it is unit-testable:
 * - protected areas (/admin, /company, /bff) refresh the access token when it is missing/expiring and a refresh cookie exists;
 * - refreshed tokens are written to the response AND to the forwarded request cookies, so the page rendered for this very
 *   request already sees the new access token;
 * - a failed refresh clears the session; protected pages then redirect to the matching login page.
 */
import { api, type AuthTokens } from '@tezfiks/shared';
import { createServerApi } from '../api/create';
import { createRefresher, type Refresher } from './refresher';
import {
  ACCESS_COOKIE,
  KIND_COOKIE,
  REFRESH_COOKIE,
  clearedSessionCookies,
  isLoginPath,
  loginPathFor,
  panelArea,
  sessionCookies,
  sessionState,
  type CookieToSet,
  type SessionKind,
} from './cookies';

export type ProxyDecision =
  | { type: 'next'; setCookies: CookieToSet[]; requestCookies: Record<string, string | null> }
  | { type: 'redirect'; location: string; setCookies: CookieToSet[] }
  | { type: 'unauthorized'; setCookies: CookieToSet[] };

export interface ProxyInput {
  /** Path without basePath, e.g. "/admin/orders". */
  pathname: string;
  /** Path + query (without basePath) used for the post-login `next` parameter. */
  pathWithSearch: string;
  cookies: Record<string, string | undefined>;
  nowMs: number;
  secure: boolean;
}

let defaultRefresher: Refresher | null = null;

/** Process-wide refresher (one Next.js server process handles all proxy invocations). */
export function sharedRefresher(): Refresher {
  if (!defaultRefresher) {
    defaultRefresher = createRefresher(async (refreshToken) => {
      const client = createServerApi();
      return client.call(api.auth.refresh, { body: { refreshToken } });
    });
  }
  return defaultRefresher;
}

function areaKind(area: ReturnType<typeof panelArea>): SessionKind | null {
  return area === 'admin' ? 'admin' : area === 'company' ? 'company' : null;
}

function loginRedirect(kind: SessionKind, pathWithSearch: string, extra: CookieToSet[]): ProxyDecision {
  const next = encodeURIComponent(pathWithSearch);
  return { type: 'redirect', location: `${loginPathFor(kind)}?next=${next}`, setCookies: extra };
}

export async function decideProxy(
  input: ProxyInput,
  refresher: Refresher = sharedRefresher(),
): Promise<ProxyDecision> {
  const area = panelArea(input.pathname);
  const passthrough: ProxyDecision = { type: 'next', setCookies: [], requestCookies: {} };
  if (area === 'public') return passthrough;

  const requiredKind = areaKind(area);
  const loginPage = isLoginPath(input.pathname);
  const state = sessionState(
    {
      accessToken: input.cookies[ACCESS_COOKIE],
      refreshToken: input.cookies[REFRESH_COOKIE],
      kind: input.cookies[KIND_COOKIE],
    },
    input.nowMs,
  );

  if (state.status === 'active') return passthrough;

  if (state.status === 'refresh') {
    const outcome = await refresher.refresh(state.refreshToken);
    if (outcome.ok) {
      const tokens: AuthTokens = outcome.tokens;
      const setCookies = sessionCookies(tokens, state.kind, input.secure);
      return {
        type: 'next',
        setCookies,
        requestCookies: {
          [ACCESS_COOKIE]: tokens.accessToken,
          [REFRESH_COOKIE]: tokens.refreshToken,
          [KIND_COOKIE]: state.kind,
        },
      };
    }
    const cleared = clearedSessionCookies(input.secure);
    if (outcome.code === 'NETWORK' || outcome.code === 'TIMEOUT' || outcome.code.startsWith('HTTP_5')) {
      // API unreachable: keep the refresh cookie (it is still valid) and let the page render its error state.
      return passthrough;
    }
    const removed = { [ACCESS_COOKIE]: null, [REFRESH_COOKIE]: null, [KIND_COOKIE]: null };
    if (loginPage || !requiredKind) {
      if (area === 'bff') return { type: 'unauthorized', setCookies: cleared };
      return { type: 'next', setCookies: cleared, requestCookies: removed };
    }
    return loginRedirect(requiredKind, input.pathWithSearch, cleared);
  }

  // No usable session.
  if (area === 'bff') return { type: 'unauthorized', setCookies: [] };
  if (loginPage || !requiredKind) return passthrough;
  return loginRedirect(requiredKind, input.pathWithSearch, []);
}
