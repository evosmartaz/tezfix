import 'server-only';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import {
  api,
  ApiError,
  asLocale,
  type AdminMe,
  type ApiClient,
  type AuthTokens,
  type Locale,
  type Me,
} from '@tezfiks/shared';
import { createServerApi } from '../api/create';
import { secureCookies } from '../env';
import {
  ACCESS_COOKIE,
  DEVICE_COOKIE,
  KIND_COOKIE,
  LOCALE_COOKIE,
  REFRESH_COOKIE,
  clearedSessionCookies,
  deviceCookie,
  isValidDeviceId,
  loginPathFor,
  newDeviceId,
  sessionCookies,
  sessionState,
  type SessionKind,
} from './cookies';

export interface PanelSession {
  kind: SessionKind;
  accessToken: string;
}

export type ManagedCompany = Me['companies'][number];

export interface AdminContext {
  session: PanelSession;
  admin: AdminMe;
  api: ApiClient;
  locale: Locale;
}

export interface ManagerContext {
  session: PanelSession;
  me: Me;
  company: ManagedCompany;
  api: ApiClient;
  locale: Locale;
}

/** Locale of the current request (cookie, az default). */
export async function getRequestLocale(): Promise<Locale> {
  const store = await cookies();
  return asLocale(store.get(LOCALE_COOKIE)?.value ?? 'az');
}

const readSessionState = cache(async () => {
  const store = await cookies();
  return sessionState(
    {
      accessToken: store.get(ACCESS_COOKIE)?.value,
      refreshToken: store.get(REFRESH_COOKIE)?.value,
      kind: store.get(KIND_COOKIE)?.value,
    },
    Date.now(),
  );
});

/** The current session from the httpOnly cookies, or null. Never exposes the refresh token. */
export const getSession = cache(async (): Promise<PanelSession | null> => {
  const state = await readSessionState();
  // 'refresh' only happens when the proxy could not refresh (API down): treat as no usable session for rendering.
  return state.status === 'active' ? { kind: state.kind, accessToken: state.accessToken } : null;
});

/**
 * Thrown by the guards when the access token expired and the proxy could not refresh it because the API was
 * unreachable (the refresh cookie is still there). The route error page is shown instead of a misleading
 * "session expired" login redirect; a retry refreshes once the API is back.
 */
export class SessionRefreshUnavailableError extends Error {
  readonly code = 'NETWORK';
  constructor() {
    super('The session could not be refreshed: the API is unreachable');
    this.name = 'SessionRefreshUnavailableError';
  }
}

async function forwardedHeaders(): Promise<{ forwardedFor: string | null; userAgent: string | null }> {
  try {
    const h = await headers();
    return { forwardedFor: h.get('x-forwarded-for'), userAgent: h.get('user-agent') };
  } catch {
    return { forwardedFor: null, userAgent: null };
  }
}

/** API client authenticated as the current session (or anonymous). Server-side only. */
export async function serverApi(session?: PanelSession | null): Promise<ApiClient> {
  const locale = await getRequestLocale();
  const fwd = await forwardedHeaders();
  return createServerApi({ accessToken: session?.accessToken ?? null, locale, ...fwd });
}

function isAuthError(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    (err.status === 401 || err.code === 'UNAUTHORIZED' || err.code === 'SESSION_REVOKED')
  );
}

function loginRedirect(kind: SessionKind): never {
  redirect(`${loginPathFor(kind)}?expired=1`);
}

/** No usable session of `kind`: error page when only the refresh failed (API down), otherwise the login. */
async function noUsableSession(kind: SessionKind): Promise<never> {
  const state = await readSessionState();
  if (state.status === 'refresh' && state.kind === kind) throw new SessionRefreshUnavailableError();
  loginRedirect(kind);
}

const loadAdmin = cache(async (accessToken: string): Promise<AdminMe | null> => {
  const client = await serverApi({ kind: 'admin', accessToken });
  try {
    return await client.call(api.admin.me);
  } catch (err) {
    if (isAuthError(err) || (err instanceof ApiError && err.status === 403)) return null;
    throw err;
  }
});

const loadMe = cache(async (accessToken: string): Promise<Me | null> => {
  const client = await serverApi({ kind: 'company', accessToken });
  try {
    return await client.call(api.me.get);
  } catch (err) {
    if (isAuthError(err) || (err instanceof ApiError && err.status === 403)) return null;
    throw err;
  }
});

/** The admin of the current request, or null (no admin session / revoked). Does not redirect. */
export async function getAdmin(): Promise<AdminMe | null> {
  const session = await getSession();
  if (!session || session.kind !== 'admin') return null;
  return loadAdmin(session.accessToken);
}

/** The phone-login user of the current company-panel session, or null. Does not redirect. */
export async function getCompanyUser(): Promise<Me | null> {
  const session = await getSession();
  if (!session || session.kind !== 'company') return null;
  return loadMe(session.accessToken);
}

/** Companies the user manages (role MANAGER). */
export function managedCompanies(me: Me): ManagedCompany[] {
  return me.companies.filter((c) => c.role === 'MANAGER');
}

/** Pages and actions under /admin: redirects to the admin login when there is no valid admin session. */
export async function requireAdmin(): Promise<AdminContext> {
  const session = await getSession();
  if (!session || session.kind !== 'admin') return noUsableSession('admin');
  const admin = await loadAdmin(session.accessToken);
  if (!admin) loginRedirect('admin');
  return { session, admin, api: await serverApi(session), locale: await getRequestLocale() };
}

/** Phone-login session for the company panel (any companies). Redirects to the company login otherwise. */
export async function requireCompanyUser(): Promise<{
  session: PanelSession;
  me: Me;
  api: ApiClient;
  locale: Locale;
}> {
  const session = await getSession();
  if (!session || session.kind !== 'company') return noUsableSession('company');
  const me = await loadMe(session.accessToken);
  if (!me) loginRedirect('company');
  return { session, me, api: await serverApi(session), locale: await getRequestLocale() };
}

/**
 * Pages and actions under /company/[companyId]: the user must be a MANAGER of that company.
 * Not a manager of it (or a WORKER only) -> 404, so company ids of other companies are not confirmed to exist.
 */
export async function requireManager(companyId: string): Promise<ManagerContext> {
  const ctx = await requireCompanyUser();
  const company = managedCompanies(ctx.me).find((c) => c.companyId === companyId);
  if (!company) notFound();
  return { ...ctx, company };
}

/** Writes the session cookies (Server Actions / route handlers only). */
export async function setSessionCookies(tokens: AuthTokens, kind: SessionKind): Promise<void> {
  const store = await cookies();
  for (const c of sessionCookies(tokens, kind, secureCookies())) store.set(c.name, c.value, c.options);
}

export async function clearSessionCookies(): Promise<void> {
  const store = await cookies();
  for (const c of clearedSessionCookies(secureCookies())) store.set(c.name, c.value, c.options);
}

/** Returns the browser's device id, creating the cookie when missing (Server Actions only). */
export async function ensureDeviceId(): Promise<string> {
  const store = await cookies();
  const existing = store.get(DEVICE_COOKIE)?.value;
  if (isValidDeviceId(existing)) return existing;
  const id = newDeviceId();
  const c = deviceCookie(id, secureCookies());
  store.set(c.name, c.value, c.options);
  return id;
}

/** Raw refresh token for logout (server-side only). */
export async function currentRefreshToken(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(REFRESH_COOKIE)?.value;
}

/** Kind cookie even when the access token expired (logout redirect target). */
export async function currentKind(): Promise<SessionKind | null> {
  const store = await cookies();
  const kind = store.get(KIND_COOKIE)?.value;
  return kind === 'admin' || kind === 'company' ? kind : null;
}
