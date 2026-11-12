import { useEffect } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { usePathname, useRootNavigationState, useRouter, useSegments } from 'expo-router';
import { entryRedirect, useEntryTarget, type EntryRoutes, type EntryTarget } from '@tezfiks/mobile';
import { inviteTokenFromPath, pendingInviteStore, stashInvite, takePendingInvite } from './invite';

export interface ProEntryDecision {
  /** Where to navigate (router.replace), or null to stay. */
  href: string | null;
  /** Invite token to stash before the login redirect. */
  stash: string | null;
  /** True when the stashed invite token has done its job (the join route is open) and is cleared. */
  consumeInvite: boolean;
  /** True when the post-onboarding destination has been reached and is cleared. */
  consumeNext?: boolean;
}

/**
 * Where a user who just finished onboarding goes instead of the tabs (the KYC flow right after "Fərdi usta" /
 * "Usta şirkəti"). Set it, then refresh `me`: when the gate moves the user out of the onboarding screens it opens this
 * route. Navigating there by hand would race the gate (stale route segments send the user to the tabs).
 */
export const entryNextStore = createStore<{ href: string | null }>(() => ({ href: null }));

export function setEntryNext(href: string | null): void {
  entryNextStore.setState({ href });
}

function pathOf(href: string): string {
  return href.split('?')[0]!.split('#')[0]!;
}

/**
 * The pro app's entry gate: the shared login → profile → onboarding → tabs gate, plus the company invite deep link
 * tezfiksusta://join/<token>:
 * - signed out on /join/<token>: stash the token and go to login;
 * - after login (onboarding or main), a stashed token opens /join/<token> once;
 * - while onboarding, /join/<token> stays open (ENTRY_ROUTES.onboarding.allow).
 */
export function proEntryRedirect(
  target: EntryTarget,
  firstSegment: string | undefined,
  pathname: string | null | undefined,
  routes: EntryRoutes,
  pendingInvite: string | null,
  nextHref: string | null = null,
): ProEntryDecision {
  const pathToken = inviteTokenFromPath(pathname);
  if (target === 'main' && nextHref) {
    if (pathname === pathOf(nextHref)) return { href: null, stash: null, consumeInvite: false, consumeNext: true };
    const gates = [routes.auth.segment, routes.profile.segment, routes.onboarding.segment, routes.offline.segment];
    if (firstSegment === undefined || gates.includes(firstSegment)) return { href: nextHref, stash: null, consumeInvite: false };
  }
  if (target === 'auth' && pathToken) {
    return { href: routes.auth.href, stash: pathToken, consumeInvite: false };
  }
  if ((target === 'onboarding' || target === 'main') && pendingInvite && !pathToken) {
    // Consumed only once the join route is on screen: consuming here would re-run the gate before the navigation
    // commits and send the user to the onboarding screen instead.
    return { href: `/join/${encodeURIComponent(pendingInvite)}`, stash: null, consumeInvite: false };
  }
  if ((target === 'onboarding' || target === 'main') && pendingInvite && pathToken) {
    // Already on an invite screen: the stash has done its job.
    return { href: entryRedirect(target, firstSegment, routes), stash: null, consumeInvite: true };
  }
  return { href: entryRedirect(target, firstSegment, routes), stash: null, consumeInvite: false };
}

/** useEntryRedirect of @tezfiks/mobile with the invite stash (see proEntryRedirect). */
export function useProEntryRedirect(routes: EntryRoutes, enabled: boolean): EntryTarget {
  const target = useEntryTarget();
  const segments = useSegments() as string[];
  const pathname = usePathname();
  const router = useRouter();
  const navState = useRootNavigationState();
  const pending = useStore(pendingInviteStore, (s) => s.token);
  const next = useStore(entryNextStore, (s) => s.href);
  const first = segments[0];
  const navReady = !!navState?.key;

  useEffect(() => {
    if (!enabled || !navReady) return;
    const decision = proEntryRedirect(target, first, pathname, routes, pending, next);
    if (decision.stash) stashInvite(decision.stash);
    if (decision.consumeInvite) takePendingInvite();
    if (decision.consumeNext) setEntryNext(null);
    if (decision.href) router.replace(decision.href as never);
  }, [enabled, navReady, target, first, pathname, routes, router, pending, next]);

  return target;
}
