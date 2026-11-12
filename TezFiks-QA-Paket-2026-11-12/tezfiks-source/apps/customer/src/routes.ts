import type { EntryRoutes } from '@tezfiks/mobile';

/** Gate screens of the customer app (board 02 A1–A3). */
export const ENTRY_ROUTES: EntryRoutes = {
  auth: { segment: '(auth)', href: '/phone' },
  profile: { segment: 'profile-setup', href: '/profile-setup' },
  onboarding: { segment: 'account-type', href: '/account-type' },
  offline: { segment: 'offline', href: '/offline' },
  main: { href: '/' },
};
