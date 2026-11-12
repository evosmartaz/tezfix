import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { FlaskConical } from 'lucide-react';
import { api } from '@tezfiks/shared';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/states';
import { DemoConsole } from '@/features/admin/components/demo-console';
import { LoadError } from '@/features/admin/components/load-error';
import { loadAdmin, optional, publicConfig } from '@/features/admin/server';

/** Demo: simulator console, only when the API runs with DEMO_MODE=true. */
export default async function AdminDemoPage() {
  const { result } = await loadAdmin(async (client) => {
    const config = await publicConfig(client);
    if (config && !config.demoMode) return { enabled: false as const };
    const [state, categories, companies] = await Promise.all([
      client.call(api.admin.demoState),
      optional(client.call(api.adminCategories.list)),
      // Bots can join an approved company as workers; without the list the form offers solo bots only.
      optional(client.call(api.admin.companies, { query: { limit: 100 } })),
    ]);
    return {
      enabled: state.enabled,
      state,
      categories: categories?.items ?? [],
      companies: (companies?.items ?? []).filter((c) => c.status === 'APPROVED').map((c) => ({ id: c.id, name: c.name })),
    };
  });
  const t = await getTranslations('panel.admin.demo');
  const disabled = (
    <div className="rounded-lg border border-border bg-surface">
      <EmptyState icon={<FlaskConical />} title={t('disabledTitle')} description={t('disabledDescription')} />
    </div>
  );

  let body: ReactNode;
  if (!result.ok) body = result.code === 'DEMO_DISABLED' ? disabled : <LoadError error={result} />;
  else if (!result.data.enabled || !('state' in result.data)) body = disabled;
  else body = <DemoConsole state={result.data.state} categories={result.data.categories} companies={result.data.companies} />;

  return (
    <div>
      <PageHeader title={t('title')} description={t('description')} />
      {body}
    </div>
  );
}
