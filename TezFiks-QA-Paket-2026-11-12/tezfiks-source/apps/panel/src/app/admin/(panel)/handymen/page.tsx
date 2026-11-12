import { getTranslations } from 'next-intl/server';
import { api } from '@tezfiks/shared';
import { PageHeader } from '@/components/page-header';
import { FilterBar } from '@/features/admin/components/filter-bar';
import { AdminLiveRefresh } from '@/features/admin/components/live-refresh';
import { LoadError } from '@/features/admin/components/load-error';
import { HandymenTable } from '@/features/admin/components/provider-tables';
import { TabLinks } from '@/features/admin/components/ui';
import { flatParams, handymenQuery, hrefWith, type SearchParams } from '@/features/admin/mappers';
import { loadAdmin } from '@/features/admin/server';

const TABS = ['all', 'pending', 'blocked'] as const;

/** Ustalar — idarəetmə və yoxlama (board 05): tabs with counts, search, KYC review entry. */
export default async function AdminHandymenPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const query = handymenQuery(sp);
  const params = flatParams(sp);
  const { result } = await loadAdmin((client) => client.call(api.admin.handymen, { query }));
  const t = await getTranslations('panel.admin.handymen');
  const activeTab = query.tab ?? 'all';

  return (
    <div>
      <AdminLiveRefresh types={['kyc', 'handyman']} />
      <PageHeader title={t('title')} />
      <TabLinks
        className="mb-4"
        tabs={TABS.map((tab) => ({
          key: tab,
          label: t(`tabs.${tab}`),
          count: result.ok ? result.data.counts[tab] : null,
          href: hrefWith('/admin/handymen', params, { tab: tab === 'all' ? undefined : tab }),
          active: activeTab === tab,
        }))}
      />
      <FilterBar path="/admin/handymen" params={params} search searchPlaceholder={t('searchPlaceholder')} />
      {result.ok ? <HandymenTable query={query} initialPage={result.data} /> : <LoadError error={result} />}
      <p className="mt-4 text-xs text-muted-foreground">{t('note')}</p>
    </div>
  );
}
