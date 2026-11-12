import { getTranslations } from 'next-intl/server';
import { api, type Category } from '@tezfiks/shared';
import { DateTime } from '@/components/date-time';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { InfoList, Rating, Section } from '@/features/admin/components/ui';
import { CompanyLoadError } from '@/features/company/components/load-error';
import { CompanySettingsForm, type TradeOption } from '@/features/company/components/settings-form';
import { loadCompany, optional } from '@/features/company/server';

/** Active service categories as trade options, grouped by their parent group. */
function tradeOptions(items: Category[]): TradeOption[] {
  const byId = new Map(items.map((c) => [c.id, c]));
  return items
    .filter((c) => c.kind === 'SERVICE' && c.active)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'az'))
    .map((c) => ({ id: c.id, name: c.name, group: (c.parentId && byId.get(c.parentId)?.name) || '' }));
}

/**
 * Tənzimləmələr: final price entry, VAT payer, trades, radius, base. The verification status is shown, but never the KYC
 * documents (only TezFiks admins see those).
 */
export default async function CompanySettingsPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const { ctx, result } = await loadCompany(companyId, (client) => client.call(api.company.get, { params: { companyId } }));
  const t = await getTranslations('panel.company.settings');
  const tc = await getTranslations('common');
  if (!result.ok) {
    return (
      <div>
        <PageHeader title={t('title')} />
        <CompanyLoadError error={result} />
      </div>
    );
  }
  const c = result.data;
  const categories = await optional(ctx.api.call(api.categories.list, { query: {} }));
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('title')} description={c.name} />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Section title={t('sections.settings')} className="xl:col-span-2">
          <CompanySettingsForm company={c} tradeOptions={tradeOptions(categories?.items ?? [])} />
        </Section>
        <Section title={t('sections.company')}>
          <InfoList
            className="sm:grid-cols-1"
            items={[
              { label: t('fields.legal'), value: `${tc(`legalForm.${c.legalForm}`)} · ${t('fields.voen', { voen: c.voen })}` },
              { label: t('fields.status'), value: <StatusBadge family="verificationStatus" status={c.status} /> },
              {
                label: t('fields.kyc'),
                value: (
                  <span>
                    {c.kyc.status === 'NONE' ? t('kycNone') : <StatusBadge family="verificationStatus" status={c.kyc.status} />}
                    {c.kyc.reviewedAt ? (
                      <span className="ml-2 text-xs text-muted-foreground">
                        <DateTime value={c.kyc.reviewedAt} mode="date" />
                      </span>
                    ) : null}
                  </span>
                ),
              },
              ...(c.kyc.rejectReason ? [{ label: t('fields.rejectReason'), value: c.kyc.rejectReason }] : []),
              { label: t('fields.rating'), value: <Rating value={c.ratingAvg} /> },
              { label: t('fields.strikes'), value: c.strikes },
              { label: t('fields.members'), value: `${c.onlineWorkers} / ${c.membersCount}` },
            ]}
          />
          <p className="mt-4 text-xs text-muted-foreground">{t('kycHint')}</p>
        </Section>
      </div>
    </div>
  );
}
