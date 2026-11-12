import { getTranslations } from 'next-intl/server';
import { api, ProjectStatus } from '@tezfiks/shared';
import { PageHeader } from '@/components/page-header';
import { FilterBar } from '@/features/admin/components/filter-bar';
import { LoadError } from '@/features/admin/components/load-error';
import { ProjectsTable } from '@/features/admin/components/projects-table';
import { flatParams, projectsQuery, type SearchParams } from '@/features/admin/mappers';
import { loadAdmin } from '@/features/admin/server';

/** Layihələr: B2B projects with their quotes. */
export default async function AdminProjectsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const query = projectsQuery(sp);
  const { result } = await loadAdmin((client) => client.call(api.admin.projects, { query }));
  const t = await getTranslations('panel.admin.projects');
  const tc = await getTranslations('common');
  return (
    <div>
      <PageHeader title={t('title')} />
      <FilterBar
        path="/admin/projects"
        params={flatParams(sp)}
        selects={[
          {
            key: 'status',
            label: t('columns.status'),
            options: ProjectStatus.values.map((v) => ({ value: v, label: tc(`projectStatus.${v}`) })),
          },
        ]}
      />
      {result.ok ? <ProjectsTable query={query} initialPage={result.data} /> : <LoadError error={result} />}
    </div>
  );
}
