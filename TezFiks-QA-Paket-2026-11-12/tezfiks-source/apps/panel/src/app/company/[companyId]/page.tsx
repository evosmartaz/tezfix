import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Activity, Briefcase, Coins, Radio, Users, Wallet } from 'lucide-react';
import { api } from '@tezfiks/shared';
import { PageHeader } from '@/components/page-header';
import { StatCard } from '@/components/stat-card';
import { buttonVariants } from '@/components/ui/button';
import { CompanyLiveRefresh } from '@/features/company/components/live-refresh';
import { CompanyLoadError } from '@/features/company/components/load-error';
import { Note } from '@/features/company/components/ui';
import { optional, section } from '@/features/company/server';
import { moneyText } from '@/lib/format';
import { requireManager } from '@/lib/session/server';

/** Company dashboard: balance, today's jobs, active jobs, workers online, fees and revenue (api.company.dashboard). */
export default async function CompanyDashboardPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const ctx = await requireManager(companyId);
  const { locale } = ctx;
  const [dash, company, offers] = await Promise.all([
    section(ctx.api.call(api.company.dashboard, { params: { companyId } }), locale),
    optional(ctx.api.call(api.company.get, { params: { companyId } })),
    optional(ctx.api.call(api.company.offers, { params: { companyId } })),
  ]);
  const t = await getTranslations('panel.company.dashboard');
  const tc = await getTranslations('common');
  const status = company?.status ?? ctx.company.companyStatus;
  const base = `/company/${companyId}`;
  const waiting = offers?.items.filter((o) => o.status === 'SENT').length ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <CompanyLiveRefresh companyId={companyId} topics={['offers', 'assignments', 'workers', 'wallet']} intervalMs={60_000} />
      <PageHeader
        title={t('title')}
        description={company?.name ?? ctx.company.companyName}
        actions={
          <>
            <Link href={`${base}/dispatch`} className={buttonVariants({})}>
              <Radio className="size-4" aria-hidden />
              {waiting > 0 ? t('openDispatchWaiting', { count: waiting }) : t('openDispatch')}
            </Link>
            <Link href={`${base}/balance`} className={buttonVariants({ variant: 'outline' })}>
              {t('topUp')}
            </Link>
          </>
        }
      />

      {status !== 'APPROVED' ? (
        <Note tone={status === 'REJECTED' || status === 'BLOCKED' ? 'danger' : 'warning'}>
          <strong>{tc(`verificationStatus.${status}`)}.</strong> {t(`statusBanner.${status}`)}
          {status === 'REJECTED' && company?.rejectReason ? ` ${t('rejectReason', { value: company.rejectReason })}` : ''}
        </Note>
      ) : null}

      {dash.ok ? (
        <>
          {dash.data.wallet.lowBalance ? <Note tone="danger">{t('lowBalance')}</Note> : null}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label={t('balance')}
              value={moneyText(dash.data.wallet.available, locale)}
              hint={t('balanceHint', { amount: moneyText(dash.data.wallet.held, locale) })}
              tone={dash.data.wallet.lowBalance ? 'danger' : 'primary'}
              icon={<Wallet />}
            />
            <StatCard label={t('jobsToday')} value={dash.data.jobsToday} icon={<Briefcase />} />
            <StatCard label={t('activeJobs')} value={dash.data.activeJobs} icon={<Activity />} />
            <StatCard
              label={t('workersOnline')}
              value={`${dash.data.onlineWorkers} / ${dash.data.membersCount}`}
              hint={t('workersHint')}
              icon={<Users />}
            />
            <StatCard label={t('revenueToday')} value={moneyText(dash.data.revenueToday, locale)} tone="ink" icon={<Coins />} />
            <StatCard label={t('feesToday')} value={moneyText(dash.data.feesToday, locale)} tone="accent" />
            <StatCard
              label={t('earnings')}
              value={moneyText(dash.data.earningsBalance, locale)}
              hint={t('earningsHint')}
              tone="primary"
            />
          </div>
        </>
      ) : (
        <CompanyLoadError error={dash} />
      )}
    </div>
  );
}
