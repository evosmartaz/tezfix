import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { AppShell } from '@/components/shell/app-shell';
import { adminNav } from '@/features/admin/nav';
import { publicConfig } from '@/features/admin/server';
import { RealtimeProvider } from '@/lib/realtime/realtime-provider';
import { requireAdmin } from '@/lib/session/server';

/** Shell of every /admin page except the login: requires a TezFiks admin session. */
export default async function AdminPanelLayout({ children }: { children: ReactNode }) {
  const { admin, api } = await requireAdmin();
  const config = await publicConfig(api);
  const t = await getTranslations('panel.shell');
  return (
    <RealtimeProvider>
      <AppShell
        subtitle={t('adminTitle')}
        nav={adminNav(config?.demoMode ?? null)}
        navNamespace="panel.nav.admin"
        userName={admin.name || admin.email}
      >
        {children}
      </AppShell>
    </RealtimeProvider>
  );
}
