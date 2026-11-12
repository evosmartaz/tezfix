import 'server-only';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ApiError, type ApiClient } from '@tezfiks/shared';
import { errorCode, errorMessageKey, isNavigationError } from '@/lib/errors';
import { requireManager, SessionRefreshUnavailableError, type ManagerContext } from '@/lib/session/server';
import type { CompanyLoadError, Loaded } from './load-types';

export const COMPANY_LOGIN_EXPIRED = '/company/login?expired=1';

/** "This endpoint/entity does not exist": unknown id, or a company endpoint that is not deployed yet. */
export function isNotFound(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 404 || err.code === 'NOT_FOUND' || err.code === 'HTTP_404');
}

function isSessionEnd(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 401 || err.code === 'SESSION_REVOKED' || err.code === 'UNAUTHORIZED');
}

/** Serializable failure for a page section that could not load its data. */
export async function toLoadError(err: unknown, locale: string): Promise<CompanyLoadError> {
  const t = await getTranslations({ locale, namespace: 'common' });
  const code = isNotFound(err) ? 'NOT_FOUND' : errorCode(err);
  const status = err instanceof ApiError ? err.status : 0;
  const apiMessage =
    err instanceof ApiError && err.status > 0 && !code.startsWith('HTTP_') && code !== 'INTERNAL' ? err.message : '';
  return { ok: false, code, status, message: apiMessage || t(errorMessageKey(code)) };
}

/**
 * Loads one section of a company page. API failures become a `CompanyLoadError` (rendered as an ErrorState) so a missing
 * endpoint of a lane still in progress never crashes the page. Navigation and a revoked session still propagate.
 */
export async function section<T>(promise: Promise<T>, locale: string): Promise<Loaded<T>> {
  try {
    return { ok: true, data: await promise };
  } catch (err) {
    if (isNavigationError(err) || err instanceof SessionRefreshUnavailableError) throw err;
    if (isSessionEnd(err)) redirect(COMPANY_LOGIN_EXPIRED);
    return toLoadError(err, locale);
  }
}

/**
 * Loads the data of a company page. Requires a MANAGER session for `companyId` (login redirect without a session, 404
 * for other companies) and turns API failures into a `CompanyLoadError`.
 */
export async function loadCompany<T>(
  companyId: string,
  fn: (client: ApiClient, ctx: ManagerContext) => Promise<T>,
): Promise<{ ctx: ManagerContext; result: Loaded<T> }> {
  const ctx = await requireManager(companyId);
  let promise: Promise<T>;
  try {
    promise = fn(ctx.api, ctx);
  } catch (err) {
    promise = Promise.reject(err);
  }
  return { ctx, result: await section(promise, ctx.locale) };
}

/** Optional extra data: null on any API failure (the page still renders its main content). */
export async function optional<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch (err) {
    if (isNavigationError(err)) throw err;
    if (isSessionEnd(err)) redirect(COMPANY_LOGIN_EXPIRED);
    return null;
  }
}
