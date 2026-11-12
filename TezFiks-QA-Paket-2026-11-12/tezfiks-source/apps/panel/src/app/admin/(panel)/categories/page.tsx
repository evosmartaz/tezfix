import { getTranslations } from 'next-intl/server';
import { api } from '@tezfiks/shared';
import { PageHeader } from '@/components/page-header';
import { CategoryManager } from '@/features/admin/components/category-manager';
import { LoadError } from '@/features/admin/components/load-error';
import { loadAdmin } from '@/features/admin/server';

/** Kateqoriyalar: all categories (active and inactive) as a tree. */
export default async function AdminCategoriesPage() {
  const { result } = await loadAdmin((client) => client.call(api.adminCategories.list));
  const t = await getTranslations('panel.admin.categories');
  return (
    <div>
      <PageHeader title={t('title')} description={t('description')} />
      {result.ok ? <CategoryManager items={result.data.items} /> : <LoadError error={result} />}
    </div>
  );
}
