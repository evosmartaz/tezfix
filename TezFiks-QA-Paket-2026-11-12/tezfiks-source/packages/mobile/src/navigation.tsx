import { useEffect } from 'react';
import { useRootNavigationState, useRouter, useSegments } from 'expo-router';
import { entryRedirect, type EntryRoutes, type EntryTarget } from './auth/route';
import { useEntryTarget } from './providers';

/**
 * Keeps the user on the right side of the auth gate (login → profile → onboarding → tabs).
 * Waits until the root navigator is mounted and `enabled` (bootstrap finished) before navigating.
 */
export function useEntryRedirect(routes: EntryRoutes, enabled: boolean): EntryTarget {
  const target = useEntryTarget();
  const segments = useSegments() as string[];
  const router = useRouter();
  const navState = useRootNavigationState();
  const first = segments[0];
  const navReady = !!navState?.key;

  useEffect(() => {
    if (!enabled || !navReady) return;
    const href = entryRedirect(target, first, routes);
    if (href) router.replace(href as never);
  }, [enabled, navReady, target, first, routes, router]);

  return target;
}
