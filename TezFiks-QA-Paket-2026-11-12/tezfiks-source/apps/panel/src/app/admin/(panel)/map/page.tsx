import { getTranslations } from 'next-intl/server';
import { api } from '@tezfiks/shared';
import { PageHeader } from '@/components/page-header';
import { LiveMapView } from '@/features/admin/components/live-map-view';
import { LoadError } from '@/features/admin/components/load-error';
import { loadAdmin } from '@/features/admin/server';

/** Xəritə: live map of handymen and searching requests (H3 hexagons). */
export default async function AdminMapPage() {
  const { result } = await loadAdmin((client) => client.call(api.admin.liveMap));
  const t = await getTranslations('panel.admin.map');
  return (
    <div>
      <PageHeader title={t('title')} description={t('description')} />
      {result.ok ? <LiveMapView initial={result.data} /> : <LoadError error={result} />}
    </div>
  );
}
