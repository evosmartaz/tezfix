import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import {
  api,
  LedgerOwnerType,
  LedgerTxKind,
  PaymentPurpose,
  PaymentStatus,
  PayoutStatus,
} from '@tezfiks/shared';
import { PageHeader } from '@/components/page-header';
import { FilterBar } from '@/features/admin/components/filter-bar';
import { LoadError } from '@/features/admin/components/load-error';
import {
  InvoicesTable,
  LedgerTxTable,
  PaymentIntentsTable,
  PayoutsTable,
  RunPayoutsButton,
} from '@/features/admin/components/payments-tables';
import { TabLinks } from '@/features/admin/components/ui';
import {
  flatParams,
  hrefWith,
  ledgerQuery,
  PAYMENT_TABS,
  paymentsQuery,
  paymentsTab,
  payoutsQuery,
  type SearchParams,
} from '@/features/admin/mappers';
import { loadAdmin } from '@/features/admin/server';

/** Ödənişlər: ledger journal, payment intents, payouts (run / mark paid / failed), invoices (mark paid). */
export default async function AdminPaymentsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const tab = paymentsTab(sp);
  const params = flatParams(sp);
  const t = await getTranslations('panel.admin.paymentsPage');
  const tc = await getTranslations('common');
  const te = await getTranslations('panel.admin.enums');

  const tabs = (
    <TabLinks
      className="mb-4"
      tabs={PAYMENT_TABS.map((key) => ({
        key,
        label: t(`tabs.${key}`),
        // Filters belong to one tab: switching tabs starts clean.
        href: hrefWith('/admin/payments', {}, { tab: key === 'ledger' ? undefined : key }),
        active: tab === key,
      }))}
    />
  );

  let body: ReactNode;
  if (tab === 'ledger') {
    const query = ledgerQuery(sp);
    const { result } = await loadAdmin((c) => c.call(api.admin.ledger, { query }));
    body = (
      <>
        <FilterBar
          path="/admin/payments"
          params={params}
          selects={[
            { key: 'kind', label: t('filters.kind'), options: LedgerTxKind.values.map((v) => ({ value: v, label: tc(`ledgerTxKind.${v}`) })) },
            {
              key: 'ownerType',
              label: t('filters.ownerType'),
              options: LedgerOwnerType.values.map((v) => ({ value: v, label: te(`ledgerOwnerType.${v}`) })),
            },
          ]}
        />
        {result.ok ? <LedgerTxTable query={query} initialPage={result.data} /> : <LoadError error={result} />}
      </>
    );
  } else if (tab === 'payments') {
    const query = paymentsQuery(sp);
    const { result } = await loadAdmin((c) => c.call(api.admin.payments, { query }));
    body = (
      <>
        <FilterBar
          path="/admin/payments"
          params={params}
          selects={[
            { key: 'status', label: t('filters.status'), options: PaymentStatus.values.map((v) => ({ value: v, label: tc(`paymentStatus.${v}`) })) },
            {
              key: 'purpose',
              label: t('filters.purpose'),
              options: PaymentPurpose.values.map((v) => ({ value: v, label: te(`paymentPurpose.${v}`) })),
            },
          ]}
        />
        {result.ok ? <PaymentIntentsTable query={query} initialPage={result.data} /> : <LoadError error={result} />}
      </>
    );
  } else if (tab === 'payouts') {
    const query = payoutsQuery(sp);
    const { result } = await loadAdmin((c) => c.call(api.admin.payouts, { query }));
    body = (
      <>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <FilterBar
            path="/admin/payments"
            params={params}
            selects={[
              { key: 'status', label: t('filters.status'), options: PayoutStatus.values.map((v) => ({ value: v, label: tc(`payoutStatus.${v}`) })) },
            ]}
          />
          <div className="mb-4">
            <RunPayoutsButton />
          </div>
        </div>
        {result.ok ? <PayoutsTable query={query} initialPage={result.data} /> : <LoadError error={result} />}
      </>
    );
  } else {
    const { result } = await loadAdmin((c) => c.call(api.admin.invoices, { query: {} }));
    body = result.ok ? <InvoicesTable initialPage={result.data} /> : <LoadError error={result} />;
  }

  return (
    <div>
      <PageHeader title={t('title')} />
      {tabs}
      {body}
    </div>
  );
}
