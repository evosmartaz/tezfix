import { getTranslations } from 'next-intl/server';
import { api } from '@tezfiks/shared';
import { PageHeader } from '@/components/page-header';
import { AuditTable } from '@/features/admin/components/audit-table';
import { FilterBar } from '@/features/admin/components/filter-bar';
import { LoadError } from '@/features/admin/components/load-error';
import { auditQuery, flatParams, type SearchParams } from '@/features/admin/mappers';
import { loadAdmin } from '@/features/admin/server';

/** Audit: paged log of admin mutations, filterable by entity. */
export default async function AdminAuditPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const query = auditQuery(sp);
  const { result } = await loadAdmin((client) => client.call(api.admin.audit, { query }));
  const t = await getTranslations('panel.admin.audit');
  return (
    <div>
      <PageHeader title={t('title')} />
      <FilterBar
        path="/admin/audit"
        params={flatParams(sp)}
        texts={[
          { key: 'entityType', label: t('filters.entityType'), placeholder: 'HandymanProfile' },
          { key: 'entityId', label: t('filters.entityId') },
        ]}
      />
      {result.ok ? <AuditTable query={query} initialPage={result.data} /> : <LoadError error={result} />}
    </div>
  );
}
