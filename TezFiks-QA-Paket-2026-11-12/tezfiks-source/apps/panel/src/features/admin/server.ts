import 'server-only';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { api, ApiError, type ApiClient } from '@tezfiks/shared';
import { errorCode, errorMessageKey, isNavigationError } from '@/lib/errors';
import {
  requireAdmin,
  SessionRefreshUnavailableError,
  type AdminContext,
} from '@/lib/session/server';
import type { AdminLoadError, Loaded } from './load-types';

/** True for "this endpoint/entity does not exist" (unknown id, or an admin endpoint that is not deployed yet). */
export function isNotFound(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 404 || err.code === 'NOT_FOUND' || err.code === 'HTTP_404');
}

/** Serializable failure for a page that could not load its data. */
export async function toLoadError(err: unknown, locale: string): Promise<AdminLoadError> {
  const t = await getTranslations({ locale, namespace: 'common' });
  const code = isNotFound(err) ? 'NOT_FOUND' : errorCode(err);
  const status = err instanceof ApiError ? err.status : 0;
  const apiMessage =
    err instanceof ApiError && err.status > 0 && !code.startsWith('HTTP_') && code !== 'INTERNAL' ? err.message : '';
  return { ok: false, code, status, message: apiMessage || t(errorMessageKey(code)) };
}

/**
 * Loads the data of an admin page. Requires an admin session (redirects to the login otherwise) and turns every API
 * failure (unknown id, endpoint not deployed yet, validation, API down) into an `AdminLoadError` the page renders as an
 * ErrorState instead of crashing. Navigation (redirect / notFound) still propagates.
 */
export async function loadAdmin<T>(
  fn: (client: ApiClient, ctx: AdminContext) => Promise<T>,
): Promise<{ ctx: AdminContext; result: Loaded<T> }> {
  const ctx = await requireAdmin();
  try {
    return { ctx, result: { ok: true, data: await fn(ctx.api, ctx) } };
  } catch (err) {
    if (isNavigationError(err) || err instanceof SessionRefreshUnavailableError) throw err;
    if (err instanceof ApiError && (err.status === 401 || err.code === 'SESSION_REVOKED')) {
      redirect('/admin/login?expired=1');
    }
    return { ctx, result: await toLoadError(err, ctx.locale) };
  }
}

/** Optional extra data for a page: null on any API failure (the page still renders its main content). */
export async function optional<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch (err) {
    if (isNavigationError(err)) throw err;
    return null;
  }
}

/** Public platform configuration (demo mode, request fee); null when the API does not answer. */
export async function publicConfig(client: ApiClient) {
  return optional(client.call(api.health.config));
}
