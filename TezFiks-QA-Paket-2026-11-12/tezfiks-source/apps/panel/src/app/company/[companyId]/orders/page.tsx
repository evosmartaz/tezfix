import { getTranslations } from 'next-intl/server';
import { api } from '@tezfiks/shared';
import { PageHeader } from '@/components/page-header';
import { TabLinks } from '@/features/admin/components/ui';
import { CompanyLiveRefresh } from '@/features/company/components/live-refresh';
import { CompanyLoadError } from '@/features/company/components/load-error';
import { OrdersTable } from '@/features/company/components/orders-table';
import { asScope } from '@/features/company/mappers';
import { loadCompany } from '@/features/company/server';

/** Sifarişlər: the company's jobs (active / history), each opening the detail with manager actions. */
export default async function CompanyOrdersPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { companyId } = await params;
  const scope = asScope((await searchParams).scope);
  const { result } = await loadCompany(companyId, (client) =>
    client.call(api.company.assignments, { params: { companyId }, query: { scope, limit: 20 } }),
  );
  const t = await getTranslations('panel.company.orders');
  const base = `/company/${companyId}/orders`;
  return (
    <div className="flex flex-col gap-4">
      <CompanyLiveRefresh companyId={companyId} topics={['assignments']} />
      <PageHeader title={t('title')} />
      <TabLinks
        tabs={[
          { key: 'active', label: t('tabs.active'), href: base, active: scope === 'active' },
          { key: 'history', label: t('tabs.history'), href: `${base}?scope=history`, active: scope === 'history' },
        ]}
      />
      {result.ok ? (
        <OrdersTable key={scope} companyId={companyId} scope={scope} initialPage={result.data} />
      ) : (
        <CompanyLoadError error={result} />
      )}
    </div>
  );
}
