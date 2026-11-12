import type { Me } from '@tezfiks/shared';
import type { AuthStatus } from './store';
import type { MobileApp } from '../runtime';

/**
 * Where the app should be for a given session:
 * loading     splash while restoring
 * offline     a session exists but the server is unreachable (retry screen)
 * auth        phone → OTP flow
 * profile     first/last name (+ photo) when `profileComplete` is false
 * onboarding  customer: account type (board 02 A3) when `me.customer` is null;
 *             pro: "Usta kimi qoşulun" when the user has no handyman profile and manages no company
 * main        tabs
 */
export type EntryTarget = 'loading' | 'offline' | 'auth' | 'profile' | 'onboarding' | 'main';

export function resolveEntry(app: MobileApp, status: AuthStatus, me: Me | null): EntryTarget {
  if (status === 'idle' || status === 'restoring') return 'loading';
  if (status === 'offline') return 'offline';
  if (status === 'signedOut') return 'auth';
  if (!me) return 'loading';
  if (!me.profileComplete) return 'profile';
  if (app === 'CUSTOMER') return me.customer ? 'main' : 'onboarding';
  const managesCompany = me.companies.some((c) => c.role === 'MANAGER');
  return me.handyman || managesCompany ? 'main' : 'onboarding';
}

/**
 * A gate screen: its first route segment and href. `allow` lists other first segments the user may stay on while
 * this gate applies, e.g. the pro app's invite route `join` (tezfiksusta://join/<token>) for users who still have to
 * onboard, so the invite token is not dropped by the redirect.
 */
export interface EntryGate {
  segment: string;
  href: string;
  allow?: readonly string[];
}

/** First route segment and href of each gate screen; `main` is where signed-in users land. */
export interface EntryRoutes {
  auth: EntryGate;
  profile: EntryGate;
  onboarding: EntryGate;
  offline: EntryGate;
  main: { href: string };
}

/**
 * Where to redirect for an entry target given the current first route segment, or null to stay.
 * Signed-in users may move freely between main screens (tabs and any detail screen added by feature lanes);
 * they are only moved out of the gate screens (login, profile, onboarding, offline).
 */
export function entryRedirect(target: EntryTarget, firstSegment: string | undefined, routes: EntryRoutes): string | null {
  if (target === 'loading') return null;
  if (target === 'main') {
    const gates = [routes.auth.segment, routes.profile.segment, routes.onboarding.segment, routes.offline.segment];
    return firstSegment === undefined || gates.includes(firstSegment) ? routes.main.href : null;
  }
  const gate = routes[target];
  if (firstSegment === gate.segment) return null;
  if (firstSegment !== undefined && gate.allow?.includes(firstSegment)) return null;
  return gate.href;
}
