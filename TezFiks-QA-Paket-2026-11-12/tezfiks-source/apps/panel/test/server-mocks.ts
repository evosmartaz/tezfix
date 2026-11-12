/**
 * Shared vi.mock factories for server modules (next/headers, next/navigation, next/cache, next-intl/server).
 * Import this file first in a test, then call `resetServerMocks()` in beforeEach.
 */
import { vi } from 'vitest';
import { createTranslator } from 'next-intl';
import { panelMessages } from '@/i18n/messages';
import { createCookieJar, NavigationThrow } from './helpers';

export const state = {
  jar: null as null | ReturnType<typeof createCookieJar>,
  headers: new Headers(),
  revalidated: [] as string[],
};

vi.mock('next/headers', () => ({
  cookies: async () => state.jar!.store,
  headers: async () => state.headers,
}));

vi.mock('next/navigation', () => ({
  redirect: (location: string) => {
    throw new NavigationThrow(`NEXT_REDIRECT;replace;${location};307;`, location);
  },
  notFound: () => {
    throw new NavigationThrow('NEXT_HTTP_ERROR_FALLBACK;404');
  },
}));

vi.mock('next/cache', () => ({
  revalidatePath: (path: string) => {
    state.revalidated.push(path);
  },
}));

vi.mock('next-intl/server', () => ({
  getTranslations: async (opts: { locale: string; namespace?: string } | string) => {
    const o = typeof opts === 'string' ? { locale: 'az', namespace: opts } : opts;
    return createTranslator({
      locale: o.locale,
      messages: panelMessages(o.locale),
      namespace: o.namespace as never,
    });
  },
}));

export function resetServerMocks(
  cookies: Record<string, string> = {},
  headers: Record<string, string> = {},
): void {
  state.jar = createCookieJar(cookies);
  state.headers = new Headers(headers);
  state.revalidated = [];
}

/** Runs `fn` and returns the redirect location it threw (fails when it did not redirect). */
export async function expectRedirect(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof NavigationThrow && err.location) return err.location;
    throw err;
  }
  throw new Error('expected a redirect');
}

export async function expectNotFound(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof NavigationThrow && err.digest.includes('404')) return;
    throw err;
  }
  throw new Error('expected notFound()');
}
