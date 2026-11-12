import { getTranslations } from 'next-intl/server';
import { api, CustomerType } from '@tezfiks/shared';
import { PageHeader } from '@/components/page-header';
import { FilterBar } from '@/features/admin/components/filter-bar';
import { LoadError } from '@/features/admin/components/load-error';
import { CustomersTable } from '@/features/admin/components/provider-tables';
import { customersQuery, flatParams, type SearchParams } from '@/features/admin/mappers';
import { loadAdmin } from '@/features/admin/server';

/** Müştərilər: individual and company customer accounts. */
export default async function AdminCustomersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const query = customersQuery(sp);
  const { result } = await loadAdmin((client) => client.call(api.admin.customers, { query }));
  const t = await getTranslations('panel.admin.customers');
  const tc = await getTranslations('common');

  return (
    <div>
      <PageHeader title={t('title')} />
      <FilterBar
        path="/admin/customers"
        params={flatParams(sp)}
        search
        searchPlaceholder={t('searchPlaceholder')}
        selects={[
          {
            key: 'type',
            label: t('columns.type'),
            options: CustomerType.values.map((v) => ({ value: v, label: tc(`customerType.${v}`) })),
          },
        ]}
      />
      {result.ok ? <CustomersTable query={query} initialPage={result.data} /> : <LoadError error={result} />}
    </div>
  );
}
