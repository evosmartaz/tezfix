import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { api } from '@tezfiks/shared';
import { DateTime } from '@/components/date-time';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { AssignmentsTable, StrikesList, WalletSummaryView } from '@/features/admin/components/detail-tables';
import { KycReview } from '@/features/admin/components/kyc-review';
import { LoadError } from '@/features/admin/components/load-error';
import { AdminLiveRefresh } from '@/features/admin/components/live-refresh';
import { HandymanActions } from '@/features/admin/components/provider-actions';
import { BotTag, DisplayStatusBadge, InfoList, PhotoGrid, Rating, Section } from '@/features/admin/components/ui';
import { WalletAdjustDialog } from '@/features/admin/components/wallet-adjust-dialog';
import { loadAdmin } from '@/features/admin/server';

/** Handyman detail: profile, side-by-side KYC review with approve/reject, block/unblock, strikes, wallet adjust. */
export default async function AdminHandymanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { result } = await loadAdmin((client) => client.call(api.admin.handyman, { params: { id } }));
  const t = await getTranslations('panel.admin.handymen');
  const ta = await getTranslations('panel.admin.common');
  const te = await getTranslations('panel.admin.enums');
  const back = (
    <Link href="/admin/handymen" className="hover:underline">
      ← {t('title')}
    </Link>
  );
  if (!result.ok) {
    return (
      <div>
        <PageHeader title={t('detailTitle')} breadcrumb={back} />
        <LoadError error={result} />
      </div>
    );
  }
  const d = result.data;
  const h = d.row;

  return (
    <div className="flex flex-col gap-6">
      <AdminLiveRefresh types={['kyc', 'handyman']} />
      <PageHeader
        breadcrumb={back}
        title={
          <span>
            {h.firstName} {h.lastName}
            {h.isBot ? <BotTag label={ta('bot')} /> : null}
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge family="verificationStatus" status={h.status} />
            <DisplayStatusBadge status={h.displayStatus} />
            <span>{h.isOnline ? ta('online') : ta('offline')}</span>
          </span>
        }
        actions={<HandymanActions handymanId={h.id} status={h.status} strikes={h.strikes} />}
      />

      {d.rejectReason && h.status === 'REJECTED' ? (
        <p className="rounded-md border border-danger/30 bg-danger/8 px-3 py-2 text-sm text-danger">
          {t('rejectReason')}: {d.rejectReason}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Section title={t('sections.profile')} className="xl:col-span-2">
          <div className="flex flex-col gap-4 sm:flex-row">
            {d.photo ? <PhotoGrid files={[d.photo]} alt={`${h.firstName} ${h.lastName}`} /> : null}
            <InfoList
              className="flex-1"
              items={[
                { label: t('fields.phone'), value: h.phone },
                { label: t('fields.kind'), value: te(`handymanKind.${h.kind}`) },
                { label: t('fields.company'), value: h.companyName ?? '—' },
                { label: t('fields.trades'), value: h.trades.length ? h.trades.join(', ') : '—' },
                { label: t('fields.rating'), value: <Rating value={h.ratingAvg} /> },
                { label: t('fields.completed'), value: h.completedCount },
                { label: t('fields.radius'), value: t('radiusValue', { km: d.serviceRadiusKm }) },
                {
                  label: t('fields.base'),
                  value: d.base ? `${d.base.lat.toFixed(5)}, ${d.base.lng.toFixed(5)}` : '—',
                },
                { label: t('fields.createdAt'), value: <DateTime value={h.createdAt} /> },
              ]}
            />
          </div>
        </Section>
        <Section
          title={t('sections.wallet')}
          actions={
            d.wallet ? (
              <WalletAdjustDialog owner={{ type: 'HANDYMAN', id: h.id }} revalidate={`/admin/handymen/${h.id}`} allowEarnings />
            ) : null
          }
        >
          {d.wallet ? (
            <WalletSummaryView wallet={d.wallet} earnings={d.earningsBalance} />
          ) : (
            <p className="text-sm text-muted-foreground">{t('companyWorkerWallet')}</p>
          )}
        </Section>
      </div>

      <Section title={t('sections.kyc')}>
        <KycReview kyc={d.kyc} />
      </Section>

      <Section title={t('sections.strikes', { count: h.strikes })}>
        <StrikesList strikes={d.strikes} />
      </Section>

      <Section title={t('sections.recentAssignments')} bodyClassName="p-0">
        <AssignmentsTable rows={d.recentAssignments} showRequest />
      </Section>
    </div>
  );
}
