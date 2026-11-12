import type { EntryRoutes } from '@tezfiks/mobile';

/**
 * Gate screens of the pro app (board 03 A: login, then "Usta kimi qoşulun").
 * While onboarding, the invite route `join` (tezfiksusta://join/<token>) and the KYC flow `kyc` (entered right after
 * the solo/company registration, before the refreshed session moves the user to the tabs) stay open.
 */
export const ENTRY_ROUTES: EntryRoutes = {
  auth: { segment: '(auth)', href: '/phone' },
  profile: { segment: 'profile-setup', href: '/profile-setup' },
  onboarding: { segment: 'onboarding', href: '/onboarding', allow: ['join', 'kyc'] },
  offline: { segment: 'offline', href: '/offline' },
  main: { href: '/' },
};
