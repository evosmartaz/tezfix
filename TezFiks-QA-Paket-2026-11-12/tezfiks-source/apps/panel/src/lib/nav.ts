/**
 * Sidebar navigation of both panels. Paths are relative to the basePath (/tezfix). Lanes P1 (admin) and P2 (company)
 * fill the pages behind these routes.
 */
export type NavIcon =
  | 'dashboard'
  | 'orders'
  | 'handymen'
  | 'companies'
  | 'customers'
  | 'payments'
  | 'cases'
  | 'projects'
  | 'categories'
  | 'map'
  | 'settings'
  | 'audit'
  | 'demo'
  | 'dispatch'
  | 'workers'
  | 'balance';

export interface NavItem {
  /** Stable id (also the translation key under panel.nav.admin / panel.nav.company). */
  id: string;
  href: string;
  icon: NavIcon;
  /** The dashboard matches only its exact path; other items also match their sub-pages. */
  exact?: boolean;
}

export const ADMIN_NAV: readonly NavItem[] = [
  { id: 'dashboard', href: '/admin', icon: 'dashboard', exact: true },
  { id: 'orders', href: '/admin/orders', icon: 'orders' },
  { id: 'handymen', href: '/admin/handymen', icon: 'handymen' },
  { id: 'companies', href: '/admin/companies', icon: 'companies' },
  { id: 'customers', href: '/admin/customers', icon: 'customers' },
  { id: 'payments', href: '/admin/payments', icon: 'payments' },
  { id: 'cases', href: '/admin/cases', icon: 'cases' },
  { id: 'projects', href: '/admin/projects', icon: 'projects' },
  { id: 'categories', href: '/admin/categories', icon: 'categories' },
  { id: 'map', href: '/admin/map', icon: 'map' },
  { id: 'settings', href: '/admin/settings', icon: 'settings' },
  { id: 'audit', href: '/admin/audit', icon: 'audit' },
  { id: 'demo', href: '/admin/demo', icon: 'demo' },
];

export function companyNav(companyId: string): NavItem[] {
  const base = `/company/${encodeURIComponent(companyId)}`;
  return [
    { id: 'dashboard', href: base, icon: 'dashboard', exact: true },
    { id: 'dispatch', href: `${base}/dispatch`, icon: 'dispatch' },
    { id: 'orders', href: `${base}/orders`, icon: 'orders' },
    { id: 'workers', href: `${base}/workers`, icon: 'workers' },
    { id: 'balance', href: `${base}/balance`, icon: 'balance' },
    { id: 'projects', href: `${base}/projects`, icon: 'projects' },
    { id: 'settings', href: `${base}/settings`, icon: 'settings' },
  ];
}

/** Whether a nav item is the active one for `pathname` (without basePath). */
export function isNavActive(item: NavItem, pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (item.exact) return path === item.href;
  return path === item.href || path.startsWith(`${item.href}/`);
}

/** Deep link that opens the TezFiks Usta app on the invite (handled by the pro app). */
export function proInviteDeepLink(token: string): string {
  return `tezfiksusta://join/${encodeURIComponent(token)}`;
}
