import { getTranslations } from 'next-intl/server';
import { api, RequestStatus } from '@tezfiks/shared';
import { PageHeader } from '@/components/page-header';
import { FilterBar } from '@/features/admin/components/filter-bar';
import { LoadError } from '@/features/admin/components/load-error';
import { RequestsTable } from '@/features/admin/components/requests-table';
import { flatParams, requestsQuery, type SearchParams } from '@/features/admin/mappers';
import { loadAdmin } from '@/features/admin/server';

/** Sifarişlər: all requests with status / text / date filters. */
export default async function AdminOrdersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const query = requestsQuery(sp);
  const { result } = await loadAdmin((client) => client.call(api.admin.requests, { query }));
  const t = await getTranslations('panel.admin.orders');
  const tc = await getTranslations('common');

  return (
    <div>
      <PageHeader title={t('title')} description={t('description')} />
      <FilterBar
        path="/admin/orders"
        params={flatParams(sp)}
        search
        searchPlaceholder={t('searchPlaceholder')}
        dates
        selects={[
          {
            key: 'status',
            label: t('columns.status'),
            options: RequestStatus.values.map((v) => ({ value: v, label: tc(`requestStatus.${v}`) })),
          },
        ]}
      />
      {result.ok ? <RequestsTable query={query} initialPage={result.data} /> : <LoadError error={result} />}
    </div>
  );
}
