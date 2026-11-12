import { getTranslations } from 'next-intl/server';
import { api } from '@tezfiks/shared';
import { PageHeader } from '@/components/page-header';
import { AdminsManager } from '@/features/admin/components/admins-manager';
import { LoadError } from '@/features/admin/components/load-error';
import { SettingsFormView } from '@/features/admin/components/settings-form';
import { Section } from '@/features/admin/components/ui';
import { loadAdmin } from '@/features/admin/server';

/** Tənzimləmələr: platform settings (with defaults and the demo badge) and admin users. */
export default async function AdminSettingsPage() {
  const { ctx, result } = await loadAdmin((client) => client.call(api.admin.settings));
  const admins = await loadAdmin((client) => client.call(api.admin.admins));
  const t = await getTranslations('panel.admin.settings');
  const canManage = ctx.admin.role === 'ADMIN';

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('title')} description={t('description')} />
      {result.ok ? (
        <SettingsFormView
          settings={result.data.settings}
          defaults={result.data.defaults}
          demoMode={result.data.demoMode}
          canEdit={canManage}
        />
      ) : (
        <LoadError error={result} />
      )}
      <Section title={t('adminsTitle')}>
        {admins.result.ok ? (
          <AdminsManager admins={admins.result.data.items} currentAdminId={ctx.admin.id} canManage={canManage} />
        ) : (
          <LoadError error={admins.result} />
        )}
      </Section>
    </div>
  );
}
