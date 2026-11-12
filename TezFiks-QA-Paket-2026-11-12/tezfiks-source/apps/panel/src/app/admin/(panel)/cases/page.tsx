import { getTranslations } from 'next-intl/server';
import { api, CaseStatus, CaseType } from '@tezfiks/shared';
import { PageHeader } from '@/components/page-header';
import { CasesTable } from '@/features/admin/components/case-components';
import { FilterBar } from '@/features/admin/components/filter-bar';
import { AdminLiveRefresh } from '@/features/admin/components/live-refresh';
import { LoadError } from '@/features/admin/components/load-error';
import { casesQuery, flatParams, type SearchParams } from '@/features/admin/mappers';
import { loadAdmin } from '@/features/admin/server';

/** Müraciətlər: guarantee claims, price disputes and reports. */
export default async function AdminCasesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const query = casesQuery(sp);
  const { result } = await loadAdmin((client) => client.call(api.admin.cases, { query }));
  const t = await getTranslations('panel.admin.cases');
  const tc = await getTranslations('common');

  return (
    <div>
      <AdminLiveRefresh types={['case']} />
      <PageHeader title={t('title')} description={t('description')} />
      <FilterBar
        path="/admin/cases"
        params={flatParams(sp)}
        selects={[
          { key: 'status', label: t('columns.status'), options: CaseStatus.values.map((v) => ({ value: v, label: tc(`caseStatus.${v}`) })) },
          { key: 'type', label: t('columns.type'), options: CaseType.values.map((v) => ({ value: v, label: tc(`caseType.${v}`) })) },
        ]}
      />
      {result.ok ? <CasesTable query={query} initialPage={result.data} /> : <LoadError error={result} />}
    </div>
  );
}
