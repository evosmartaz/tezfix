import type { ReactNode } from 'react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ArrowLeftRight } from 'lucide-react';
import { AppShell } from '@/components/shell/app-shell';
import { companyNav } from '@/lib/nav';
import { RealtimeProvider } from '@/lib/realtime/realtime-provider';
import { managedCompanies, requireManager } from '@/lib/session/server';

/** Shell of the company panel: the user must be a MANAGER of this company (otherwise 404). */
export default async function CompanyLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const { me, company } = await requireManager(companyId);
  const t = await getTranslations('panel.shell');
  const several = managedCompanies(me).length > 1;
  const name = [me.firstName, me.lastName].filter(Boolean).join(' ') || me.phone;
  return (
    <RealtimeProvider>
      <AppShell
        subtitle={company.companyName}
        nav={companyNav(companyId)}
        navNamespace="panel.nav.company"
        userName={name}
        sidebarFooter={
          several ? (
            <Link
              href="/company"
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-white/75 hover:bg-white/8 hover:text-white"
            >
              <ArrowLeftRight className="size-4" aria-hidden />
              {t('switchCompany')}
            </Link>
          ) : undefined
        }
      >
        {children}
      </AppShell>
    </RealtimeProvider>
  );
}
