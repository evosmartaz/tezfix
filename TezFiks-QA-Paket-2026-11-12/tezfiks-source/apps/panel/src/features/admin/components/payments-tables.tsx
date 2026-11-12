'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCheck, Play, X } from 'lucide-react';
import type { AdminLedgerTx, InvoiceView } from '@tezfiks/shared';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DataTable, dataTableColumns, type CursorPage } from '@/components/data-table';
import { DateTime } from '@/components/date-time';
import { Money } from '@/components/money';
import { StatusBadge } from '@/components/status-badge';
import { toast } from '@/components/toaster';
import { Button } from '@/components/ui/button';
import { moneyText } from '@/lib/format';
import {
  listInvoicesAction,
  listLedgerAction,
  listPaymentsAction,
  listPayoutsAction,
  markInvoicePaidAction,
  markPayoutFailedAction,
  markPayoutPaidAction,
  runPayoutsAction,
} from '../actions';
import { requestNo } from '../mappers';
import type { AdminPaymentRow, AdminPayoutRow } from '../types';
import { ConfirmButton, ReasonButton } from './action-buttons';
import { LedgerEntries } from './detail-tables';

type LedgerQuery = Parameters<typeof listLedgerAction>[0];
type PaymentsQuery = Parameters<typeof listPaymentsAction>[0];
type PayoutsQuery = Parameters<typeof listPayoutsAction>[0];

const withCursor = <Q extends object>(query: Q, cursor: string | null) => ({ ...query, ...(cursor ? { cursor } : {}) });

/** Ledger journal (every double-entry transaction). */
export function LedgerTxTable({ query, initialPage }: { query: LedgerQuery; initialPage?: CursorPage<AdminLedgerTx> }) {
  const t = useTranslations('panel.admin.ledger');
  const tc = useTranslations('common');
  const columns = useMemo(() => {
    const col = dataTableColumns<AdminLedgerTx>();
    return [
      col.accessor('createdAt', { header: () => t('createdAt'), cell: (info) => <DateTime value={info.getValue()} /> }),
      col.accessor('kind', {
        header: () => t('kind'),
        cell: (info) => (
          <div>
            <div className="font-medium">{tc(`ledgerTxKind.${info.getValue()}`)}</div>
            {info.row.original.requestNumber !== null ? (
              <div className="text-xs text-muted-foreground">{requestNo(info.row.original.requestNumber)}</div>
            ) : null}
          </div>
        ),
      }),
      col.display({ id: 'entries', header: () => t('entries'), cell: (info) => <LedgerEntries tx={info.row.original} /> }),
      col.accessor('memo', {
        header: () => t('memo'),
        cell: (info) => (
          <div className="max-w-64 text-xs text-muted-foreground">
            {info.getValue() ?? '—'}
            {info.row.original.actor ? <div>{info.row.original.actor}</div> : null}
          </div>
        ),
      }),
    ];
  }, [t, tc]);
  return (
    <DataTable
      columns={columns}
      queryKey={['admin', 'ledger', query]}
      fetchPage={(cursor) => listLedgerAction(withCursor(query, cursor))}
      initialPage={initialPage}
      getRowId={(r) => r.id}
      emptyTitle={t('empty')}
    />
  );
}

/** Payment intents (top-ups, card job payments, tips, invoices). */
export function PaymentIntentsTable({ query, initialPage }: { query: PaymentsQuery; initialPage?: CursorPage<AdminPaymentRow> }) {
  const t = useTranslations('panel.admin.payments');
  const te = useTranslations('panel.admin.enums');
  const columns = useMemo(() => {
    const col = dataTableColumns<AdminPaymentRow>();
    return [
      col.accessor('createdAt', { header: () => t('columns.createdAt'), cell: (info) => <DateTime value={info.getValue()} /> }),
      col.accessor('payerName', { header: () => t('columns.payer'), cell: (info) => info.getValue() ?? '—' }),
      col.accessor('purpose', { header: () => t('columns.purpose'), cell: (info) => te(`paymentPurpose.${info.getValue()}`) }),
      col.accessor('amount', { header: () => t('columns.amount'), cell: (info) => <Money minor={info.getValue()} /> }),
      col.accessor('status', {
        header: () => t('columns.status'),
        cell: (info) => (
          <div>
            <StatusBadge family="paymentStatus" status={info.getValue()} />
            {info.row.original.failureReason ? (
              <div className="mt-1 text-xs text-danger">{info.row.original.failureReason}</div>
            ) : null}
          </div>
        ),
      }),
      col.accessor('provider', { header: () => t('columns.provider') }),
      col.accessor('completedAt', { header: () => t('columns.completedAt'), cell: (info) => <DateTime value={info.getValue()} /> }),
    ];
  }, [t, te]);
  return (
    <DataTable
      columns={columns}
      queryKey={['admin', 'payments', query]}
      fetchPage={(cursor) => listPaymentsAction(withCursor(query, cursor))}
      initialPage={initialPage}
      getRowId={(r) => r.id}
      emptyTitle={t('empty')}
    />
  );
}

function useRefreshList(key: string) {
  const router = useRouter();
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['admin', key] });
    router.refresh();
  };
}

function PayoutRowActions({ payout }: { payout: AdminPayoutRow }) {
  const t = useTranslations('panel.admin.payouts');
  const refresh = useRefreshList('payouts');
  if (payout.status !== 'PENDING') return null;
  return (
    <div className="flex flex-wrap gap-2">
      <ConfirmButton
        label={t('markPaid')}
        icon={<CheckCheck />}
        description={t('markPaidDescription')}
        successMessage={t('markedPaid')}
        action={async () => {
          const r = await markPayoutPaidAction(payout.id);
          if (r.ok) refresh();
          return r;
        }}
      />
      <ReasonButton
        label={t('markFailed')}
        icon={<X />}
        title={t('markFailedTitle')}
        description={t('markFailedDescription')}
        successMessage={t('markedFailed')}
        action={async (reason) => {
          const r = await markPayoutFailedAction(payout.id, { reason });
          if (r.ok) refresh();
          return r;
        }}
      />
    </div>
  );
}

/** Weekly payouts of earnings with mark paid / failed. */
export function PayoutsTable({ query, initialPage }: { query: PayoutsQuery; initialPage?: CursorPage<AdminPayoutRow> }) {
  const t = useTranslations('panel.admin.payouts');
  const te = useTranslations('panel.admin.enums');
  const columns = useMemo(() => {
    const col = dataTableColumns<AdminPayoutRow>();
    return [
      col.accessor('ownerName', {
        header: () => t('columns.owner'),
        cell: (info) => (
          <div>
            <div className="font-medium">{info.getValue()}</div>
            <div className="text-xs text-muted-foreground">{te(`payoutOwnerType.${info.row.original.ownerType}`)}</div>
          </div>
        ),
      }),
      col.accessor('periodStart', {
        header: () => t('columns.period'),
        cell: (info) => (
          <span className="whitespace-nowrap">
            <DateTime value={info.getValue()} mode="date" /> – <DateTime value={info.row.original.periodEnd} mode="date" />
          </span>
        ),
      }),
      col.accessor('amount', { header: () => t('columns.amount'), cell: (info) => <Money minor={info.getValue()} /> }),
      col.accessor('method', {
        header: () => t('columns.method'),
        cell: (info) => {
          const m = info.getValue();
          return m ? `${te(`payoutMethodType.${m.type}`)} ${m.maskedNumber} · ${m.holderName}` : t("noMethod");
        },
      }),
      col.accessor('status', {
        header: () => t('columns.status'),
        cell: (info) => (
          <div>
            <StatusBadge family="payoutStatus" status={info.getValue()} />
            {info.row.original.failureReason ? (
              <div className="mt-1 text-xs text-danger">{info.row.original.failureReason}</div>
            ) : null}
          </div>
        ),
      }),
      col.accessor('paidAt', { header: () => t('columns.paidAt'), cell: (info) => <DateTime value={info.getValue()} /> }),
      col.display({ id: 'actions', header: () => t('columns.actions'), cell: (info) => <PayoutRowActions payout={info.row.original} /> }),
    ];
  }, [t, te]);
  return (
    <DataTable
      columns={columns}
      queryKey={['admin', 'payouts', query]}
      fetchPage={(cursor) => listPayoutsAction(withCursor(query, cursor))}
      initialPage={initialPage}
      getRowId={(r) => r.id}
      emptyTitle={t('empty')}
    />
  );
}

/** Runs the weekly payout job now and reports how many payouts were created. */
export function RunPayoutsButton() {
  const t = useTranslations('panel.admin.payouts');
  const locale = useLocale();
  const refresh = useRefreshList('payouts');
  const [busy, setBusy] = useState(false);
  return (
    <ConfirmDialog
      trigger={
        <Button size="sm" loading={busy}>
          <Play />
          {t('run')}
        </Button>
      }
      title={t('run')}
      description={t('runDescription')}
      confirmLabel={t('run')}
      onConfirm={async () => {
        setBusy(true);
        try {
          const r = await runPayoutsAction();
          if (!r.ok) {
            toast.error(r.message);
            return false;
          }
          toast.success(t('runResult', { count: r.data.created, total: moneyText(r.data.total, locale) }));
          refresh();
          return true;
        } finally {
          setBusy(false);
        }
      }}
    />
  );
}

export function InvoiceRowActions({ invoice }: { invoice: InvoiceView }) {
  const t = useTranslations('panel.admin.invoices');
  const refresh = useRefreshList('invoices');
  if (invoice.status !== 'ISSUED') return null;
  return (
    <ConfirmButton
      label={t('markPaid')}
      icon={<CheckCheck />}
      description={t('markPaidDescription')}
      successMessage={t('markedPaid')}
      action={async () => {
        const r = await markInvoicePaidAction(invoice.id);
        if (r.ok) refresh();
        return r;
      }}
    />
  );
}

/** B2B invoices (bank transfer) with "mark paid". */
export function InvoicesTable({ initialPage }: { initialPage?: CursorPage<InvoiceView> }) {
  const t = useTranslations('panel.admin.invoices');
  const columns = useMemo(() => {
    const col = dataTableColumns<InvoiceView>();
    return [
      col.accessor('number', {
        header: () => t('columns.number'),
        cell: (info) => (
          <div>
            <div className="font-semibold">{info.getValue()}</div>
            <div className="text-xs text-muted-foreground">{t('project', { number: info.row.original.projectNumber })}</div>
          </div>
        ),
      }),
      col.display({
        id: 'parties',
        header: () => t('columns.parties'),
        cell: (info) => (
          <div className="text-sm">
            <div>{info.row.original.issuer.name}</div>
            <div className="text-xs text-muted-foreground">→ {info.row.original.customer.name}</div>
          </div>
        ),
      }),
      col.accessor('total', {
        header: () => t('columns.total'),
        cell: (info) => (
          <div>
            <Money minor={info.getValue()} />
            {info.row.original.vatAmount > 0 ? (
              <div className="text-xs text-muted-foreground">
                {t('vat', { rate: info.row.original.vatRatePercent })}: <Money minor={info.row.original.vatAmount} />
              </div>
            ) : null}
          </div>
        ),
      }),
      col.accessor('status', { header: () => t('columns.status'), cell: (info) => <StatusBadge family="invoiceStatus" status={info.getValue()} /> }),
      col.accessor('issuedAt', { header: () => t('columns.issuedAt'), cell: (info) => <DateTime value={info.getValue()} mode="date" /> }),
      col.accessor('paidAt', { header: () => t('columns.paidAt'), cell: (info) => <DateTime value={info.getValue()} mode="date" /> }),
      col.display({ id: 'actions', header: () => t('columns.actions'), cell: (info) => <InvoiceRowActions invoice={info.row.original} /> }),
    ];
  }, [t]);
  return (
    <DataTable
      columns={columns}
      queryKey={['admin', 'invoices']}
      fetchPage={(cursor) => listInvoicesAction(cursor ? { cursor } : {})}
      initialPage={initialPage}
      getRowId={(r) => r.id}
      emptyTitle={t('empty')}
    />
  );
}
