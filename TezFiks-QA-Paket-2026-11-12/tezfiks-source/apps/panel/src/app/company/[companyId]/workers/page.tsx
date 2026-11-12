import { getTranslations } from 'next-intl/server';
import { api } from '@tezfiks/shared';
import { PageHeader } from '@/components/page-header';
import { Section } from '@/features/admin/components/ui';
import { CompanyLiveRefresh } from '@/features/company/components/live-refresh';
import { CompanyLoadError } from '@/features/company/components/load-error';
import { InvitesManager, MembersTable } from '@/features/company/components/workers-manager';
import { optional, section } from '@/features/company/server';
import { requireManager } from '@/lib/session/server';

/**
 * Ustalar: members (with phones: the company employs them), roles, trades, presence, remove; invite links.
 * Managers never see KYC documents here (only TezFiks admins review them).
 */
export default async function CompanyWorkersPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const ctx = await requireManager(companyId);
  const p = { params: { companyId } };
  const [members, invites, company] = await Promise.all([
    section(ctx.api.call(api.company.members, p), ctx.locale),
    section(ctx.api.call(api.company.invites, p), ctx.locale),
    optional(ctx.api.call(api.company.get, p)),
  ]);
  const t = await getTranslations('panel.company.workers');
  const activeCount = members.ok ? members.data.items.filter((m) => m.status === 'ACTIVE').length : null;
  // Server-rendered "now" for the invite state (the page re-renders on every visit).
  const nowMs = Date.now();
  return (
    <div className="flex flex-col gap-6">
      <CompanyLiveRefresh companyId={companyId} topics={['workers']} />
      <PageHeader title={t('title')} description={t('subtitle')} />
      <Section
        title={activeCount !== null ? t('members.titleCount', { count: activeCount }) : t('members.title')}
        bodyClassName="p-0"
      >
        {members.ok ? (
          <MembersTable
            companyId={companyId}
            members={members.data.items}
            myUserId={ctx.me.id}
            companyTrades={company?.trades ?? []}
          />
        ) : (
          <CompanyLoadError error={members} className="border-0" />
        )}
      </Section>
      <Section title={t('invites.title')}>
        {invites.ok ? (
          <InvitesManager companyId={companyId} invites={invites.data.items} nowMs={nowMs} />
        ) : (
          <CompanyLoadError error={invites} className="border-0" />
        )}
      </Section>
    </div>
  );
}
