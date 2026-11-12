import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { api } from '@tezfiks/shared';
import { DateTime } from '@/components/date-time';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { WalletSummaryView } from '@/features/admin/components/detail-tables';
import { LoadError } from '@/features/admin/components/load-error';
import { OrderRows } from '@/features/admin/components/order-rows';
import { UserBlockActions } from '@/features/admin/components/provider-actions';
import { InfoList, Rating, Section } from '@/features/admin/components/ui';
import { WalletAdjustDialog } from '@/features/admin/components/wallet-adjust-dialog';
import { loadAdmin } from '@/features/admin/server';

/** Customer detail: account, wallet (debt) with adjustment, recent requests, block / unblock the user. */
export default async function AdminCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { result } = await loadAdmin((client) => client.call(api.admin.customer, { params: { id } }));
  const t = await getTranslations('panel.admin.customers');
  const tc = await getTranslations('common');
  const back = (
    <Link href="/admin/customers" className="hover:underline">
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
  const path = `/admin/customers/${c.id}`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumb={back}
        title={c.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge family="userStatus" status={c.userStatus} />
            <span>{tc(`customerType.${c.type}`)}</span>
          </span>
        }
        actions={<UserBlockActions userId={c.userId} status={c.userStatus} revalidate={path} />}
      />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Section title={t('sections.account')} className="xl:col-span-2">
          <InfoList
            items={[
              { label: tc('fields.phone'), value: c.phone },
              { label: tc('fields.companyName'), value: c.companyName ?? '—' },
              { label: t('columns.requests'), value: c.requestsCount },
              { label: t('columns.rating'), value: <Rating value={c.ratingAvg} /> },
              { label: t('columns.createdAt'), value: <DateTime value={c.createdAt} /> },
            ]}
          />
        </Section>
        <Section
          title={t('sections.wallet')}
          actions={<WalletAdjustDialog owner={{ type: 'CUSTOMER_ACCOUNT', id: c.id }} revalidate={path} />}
        >
          <WalletSummaryView wallet={d.wallet} />
        </Section>
      </div>
      <Section title={t('sections.recentRequests')} bodyClassName="p-0">
        <OrderRows rows={d.recentRequests} showDate />
      </Section>
    </div>
  );
}
