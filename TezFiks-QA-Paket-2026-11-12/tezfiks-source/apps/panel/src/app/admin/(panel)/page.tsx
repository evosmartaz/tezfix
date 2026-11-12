import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { AlertTriangle, BadgeCheck, Building2 } from 'lucide-react';
import { api } from '@tezfiks/shared';
import { PageHeader } from '@/components/page-header';
import { StatCard } from '@/components/stat-card';
import { moneyText } from '@/lib/format';
import { LoadError } from '@/features/admin/components/load-error';
import { AdminLiveRefresh } from '@/features/admin/components/live-refresh';
import { OrderRows } from '@/features/admin/components/order-rows';
import { Section } from '@/features/admin/components/ui';
import { dashboardKpis, longDate } from '@/features/admin/mappers';
import { loadAdmin, publicConfig } from '@/features/admin/server';

/** Board 05 dashboard: today's orders (delta), active/online handymen, today's fee revenue, cancel rate, recent orders. */
export default async function AdminDashboardPage() {
  const { ctx, result } = await loadAdmin(async (client) => {
    const [dashboard, config] = await Promise.all([client.call(api.admin.dashboard), publicConfig(client)]);
    return { dashboard, config };
  });
  const t = await getTranslations('panel.admin.dashboard');
  const tm = await getTranslations('panel.admin.months');
  if (!result.ok) {
    return (
      <div>
        <PageHeader title={t('title')} />
        <LoadError error={result} />
      </div>
    );
  }
  const { dashboard: d, config } = result.data;
  const k = dashboardKpis(d, ctx.locale, config?.requestFee);
  const date = longDate(d.date, (m) => tm(`m${m}`));

  return (
    <div className="flex flex-col gap-6">
      <AdminLiveRefresh intervalMs={60_000} />
      <PageHeader title={t('titleWithDate', { date })} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t('ordersToday')}
          value={k.ordersToday}
          tone="primary"
          hint={k.ordersDelta === '—' ? t('noComparison') : t('vsYesterday', { delta: k.ordersDelta })}
        />
        <StatCard
          label={t('activeHandymen')}
          value={k.activeHandymen}
          tone="ink"
          hint={t('online', { count: k.onlineHandymen })}
        />
        <StatCard
          label={t('revenueToday')}
          value={moneyText(k.feeRevenueToday, ctx.locale, { compact: true })}
          tone="accent"
          hint={t('revenueHint', {
            count: k.feeOrdersToday,
            fee: moneyText(k.feePerOrder, ctx.locale, { compact: true }),
          })}
        />
        <StatCard
          label={t('cancelRate')}
          value={k.cancelRate}
          tone="danger"
          hint={k.cancelRateDelta === '—' ? t('noComparison') : t('thisWeek', { delta: k.cancelRateDelta })}
        />
      </div>

      {d.pendingKyc + d.pendingCompanies + d.openCases > 0 ? (
        <div className="flex flex-wrap gap-3">
          {d.pendingKyc > 0 ? (
            <Link
              href="/admin/handymen?tab=pending"
              className="inline-flex items-center gap-2 rounded-md border border-accent/30 bg-accent/10 px-3 py-2 text-sm font-medium text-accent-strong hover:bg-accent/15"
            >
              <BadgeCheck className="size-4" />
              {t('pendingKyc', { count: d.pendingKyc })}
            </Link>
          ) : null}
          {d.pendingCompanies > 0 ? (
            <Link
              href="/admin/companies?tab=pending"
              className="inline-flex items-center gap-2 rounded-md border border-accent/30 bg-accent/10 px-3 py-2 text-sm font-medium text-accent-strong hover:bg-accent/15"
            >
              <Building2 className="size-4" />
              {t('pendingCompanies', { count: d.pendingCompanies })}
            </Link>
          ) : null}
          {d.openCases > 0 ? (
            <Link
              href="/admin/cases?status=OPEN"
              className="inline-flex items-center gap-2 rounded-md border border-danger/30 bg-danger/8 px-3 py-2 text-sm font-medium text-danger hover:bg-danger/12"
            >
              <AlertTriangle className="size-4" />
              {t('openCases', { count: d.openCases })}
            </Link>
          ) : null}
        </div>
      ) : null}

      <Section
        title={t('recentOrders')}
        actions={
          <Link href="/admin/orders" className="text-sm font-semibold text-primary hover:underline">
            {t('allOrders')} →
          </Link>
        }
        bodyClassName="p-0"
      >
        <OrderRows rows={d.recentOrders} />
      </Section>
    </div>
  );
}
