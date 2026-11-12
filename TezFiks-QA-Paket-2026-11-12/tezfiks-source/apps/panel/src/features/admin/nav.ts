import { ADMIN_NAV, type NavItem } from '@/lib/nav';

/**
 * Admin sidebar: the Demo item is only shown when the API runs in demo mode. When the mode is unknown (public config
 * unavailable) the item stays visible; the Demo page itself explains when the simulator is off.
 */
export function adminNav(demoMode: boolean | null): readonly NavItem[] {
  return demoMode === false ? ADMIN_NAV.filter((item) => item.id !== 'demo') : ADMIN_NAV;
}
