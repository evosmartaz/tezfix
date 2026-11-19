'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Banknote,
  Building2,
  ClipboardList,
  FileSearch,
  FlaskConical,
  FolderKanban,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Map as MapIcon,
  Menu,
  Radio,
  Settings,
  Shapes,
  UserRound,
  Users,
  Wallet,
  Wrench,
} from 'lucide-react';
import { Dialog, SheetContent, SheetTitle } from '@/components/ui/dialog';
import { LanguageSwitcher } from '@/components/language-switcher';
import { logoutAction } from '@/lib/actions/auth';
import { isNavActive, type NavIcon, type NavItem } from '@/lib/nav';
import { useRealtime } from '@/lib/realtime/realtime-provider';
import { cn } from '@/lib/utils';

const ICONS: Record<NavIcon, typeof LayoutDashboard> = {
  dashboard: LayoutDashboard,
  orders: ClipboardList,
  handymen: Wrench,
  companies: Building2,
  customers: UserRound,
  payments: Banknote,
  cases: LifeBuoy,
  projects: FolderKanban,
  categories: Shapes,
  map: MapIcon,
  settings: Settings,
  audit: FileSearch,
  demo: FlaskConical,
  dispatch: Radio,
  workers: Users,
  balance: Wallet,
};

export interface AppShellProps {
  /** Brand line under "TezFiks" (e.g. "Admin" or the company name). */
  subtitle: ReactNode;
  nav: readonly NavItem[];
  /** Translation namespace of the nav labels: "panel.nav.admin" or "panel.nav.company". */
  navNamespace: 'panel.nav.admin' | 'panel.nav.company';
  userName: ReactNode;
  /** Extra sidebar footer content (e.g. "switch company" link). */
  sidebarFooter?: ReactNode;
  children: ReactNode;
}

function Sidebar({
  subtitle,
  nav,
  navNamespace,
  sidebarFooter,
  onNavigate,
}: Omit<AppShellProps, 'children' | 'userName'> & { onNavigate?: () => void }) {
  const t = useTranslations(navNamespace);
  const pathname = usePathname() ?? '/';
  return (
    <div className="flex h-full flex-col bg-ink text-white">
      <div className="px-6 pt-6 pb-5">
        <div className="text-xl font-bold tracking-tight">TezFiks</div>
        <div className="mt-0.5 truncate text-xs text-white/55">{subtitle}</div>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3" aria-label="main">
        {nav.map((item) => {
          const Icon = ICONS[item.icon];
          const active = isNavActive(item, pathname);
          return (
            <Link
              key={item.id}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-colors',
                active ? 'bg-primary text-white' : 'text-white/75 hover:bg-white/8 hover:text-white',
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              <span className="truncate">{t(item.id)}</span>
            </Link>
          );
        })}
      </nav>
      {sidebarFooter ? <div className="border-t border-white/10 px-3 py-3">{sidebarFooter}</div> : null}
    </div>
  );
}

function ConnectionDot() {
  const t = useTranslations('panel.shell');
  const { socket, connected } = useRealtime();
  if (!socket) return null;
  return (
    <span
      className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:inline-flex"
      title={connected ? t('live') : t('offline')}
    >
      <span className={cn('size-2 rounded-full', connected ? 'bg-primary' : 'bg-danger')} aria-hidden />
      {connected ? t('live') : t('offline')}
    </span>
  );
}

/** Dark sidebar + header layout of both panels (board 05). */
export function AppShell(props: AppShellProps) {
  const { userName, children } = props;
  const t = useTranslations('panel.shell');
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-[248px] shrink-0 lg:block">
        <Sidebar {...props} />
      </aside>
      <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-[248px] bg-ink p-0" closeLabel={t('closeMenu')}>
          <SheetTitle className="sr-only">TezFiks</SheetTitle>
          <Sidebar {...props} onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Dialog>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-surface/95 px-4 backdrop-blur lg:px-8">
          <button
            type="button"
            className="rounded-md p-2 text-foreground hover:bg-muted lg:hidden"
            aria-label={t('openMenu')}
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="size-5" />
          </button>
          <div className="flex-1" />
          <ConnectionDot />
          <LanguageSwitcher />
          <span className="hidden max-w-48 truncate text-sm text-muted-foreground md:inline">{userName}</span>
          <form action={logoutAction}>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium text-foreground hover:bg-muted"
            >
              <LogOut className="size-4" aria-hidden />
              <span className="hidden sm:inline">{t('logout')}</span>
            </button>
          </form>
        </header>
        <main className="flex-1 px-4 py-6 lg:px-10 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
