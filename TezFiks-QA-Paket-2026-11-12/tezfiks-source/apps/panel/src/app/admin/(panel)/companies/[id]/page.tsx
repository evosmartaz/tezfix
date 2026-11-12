import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { api } from '@tezfiks/shared';
import { DateTime } from '@/components/date-time';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StrikesList, WalletSummaryView } from '@/features/admin/components/detail-tables';
import { KycReview } from '@/features/admin/components/kyc-review';
import { LoadError } from '@/features/admin/components/load-error';
import { AdminLiveRefresh } from '@/features/admin/components/live-refresh';
import { CompanyActions } from '@/features/admin/components/provider-actions';
import { InfoList, Rating, Section } from '@/features/admin/components/ui';
import { WalletAdjustDialog } from '@/features/admin/components/wallet-adjust-dialog';
import { loadAdmin } from '@/features/admin/server';

/** Company detail: data, KYC documents, approve/reject/block, members, wallet adjust, strikes. */
export default async function AdminCompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { result } = await loadAdmin((client) => client.call(api.admin.company, { params: { id } }));
  const t = await getTranslations('panel.admin.companies');
  const ta = await getTranslations('panel.admin.common');
  const tc = await getTranslations('common');
  const back = (
    <Link href="/admin/companies" className="hover:underline">
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
  const c = d.row;

  return (
    <div className="flex flex-col gap-6">
      <AdminLiveRefresh types={['kyc', 'company']} />
      <PageHeader
        breadcrumb={back}
        title={c.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge family="verificationStatus" status={c.status} />
            <span>
              {tc(`legalForm.${c.legalForm}`)} · {t('voen', { voen: c.voen })}
            </span>
          </span>
        }
        actions={<CompanyActions companyId={c.id} status={c.status} />}
      />
      {d.rejectReason && c.status === 'REJECTED' ? (
        <p className="rounded-md border border-danger/30 bg-danger/8 px-3 py-2 text-sm text-danger">
          {t('rejectReason')}: {d.rejectReason}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Section title={t('sections.company')} className="xl:col-span-2">
          <InfoList
            items={[
              { label: t('fields.owner'), value: `${c.ownerName} · ${c.ownerPhone}` },
              { label: t('fields.members'), value: c.membersCount },
              { label: t('fields.finalPriceEntry'), value: tc(`finalPriceEntry.${d.finalPriceEntry}`) },
              { label: t('fields.vat'), value: d.isVatPayer ? ta('yes') : ta('no') },
              { label: t('fields.trades'), value: d.trades.length ? d.trades.join(', ') : '—' },
              { label: t('fields.rating'), value: <Rating value={c.ratingAvg} /> },
              { label: t('fields.createdAt'), value: <DateTime value={c.createdAt} /> },
            ]}
          />
        </Section>
        <Section
          title={t('sections.wallet')}
          actions={<WalletAdjustDialog owner={{ type: 'COMPANY', id: c.id }} revalidate={`/admin/companies/${c.id}`} allowEarnings />}
        >
          <WalletSummaryView wallet={d.wallet} earnings={d.earningsBalance} />
        </Section>
      </div>

      <Section title={t('sections.members', { count: d.members.length })} bodyClassName="p-0">
        {d.members.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">{t('noMembers')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>{t('memberColumns.name')}</TableHead>
                <TableHead>{t('memberColumns.role')}</TableHead>
                <TableHead>{t('memberColumns.trades')}</TableHead>
                <TableHead>{t('memberColumns.rating')}</TableHead>
                <TableHead>{t('memberColumns.completed')}</TableHead>
                <TableHead>{t('memberColumns.presence')}</TableHead>
                <TableHead>{t('memberColumns.status')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.members.map((m) => (
                <TableRow key={m.userId}>
                  <TableCell>
                    {m.handymanId ? (
                      <Link href={`/admin/handymen/${m.handymanId}`} className="font-medium text-primary hover:underline">
                        {m.firstName} {m.lastName}
                      </Link>
                    ) : (
                      <span className="font-medium">
                        {m.firstName} {m.lastName}
                      </span>
                    )}
                    <div className="text-xs text-muted-foreground">{m.phone}</div>
                  </TableCell>
                  <TableCell>{tc(`companyRole.${m.role}`)}</TableCell>
                  <TableCell>{m.trades.length ? m.trades.map((tr) => tr.name).join(', ') : '—'}</TableCell>
                  <TableCell>
                    <Rating value={m.ratingAvg} />
                  </TableCell>
                  <TableCell>{m.completedCount}</TableCell>
                  <TableCell>{m.busy ? ta('busy') : m.isOnline ? ta('online') : ta('offline')}</TableCell>
                  <TableCell>
                    <StatusBadge family="memberStatus" status={m.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <Section title={t('sections.kyc')}>
        <KycReview kyc={d.kyc} />
      </Section>

      <Section title={t('sections.strikes', { count: c.strikes })}>
        <StrikesList strikes={d.strikes} />
      </Section>
    </div>
  );
}
