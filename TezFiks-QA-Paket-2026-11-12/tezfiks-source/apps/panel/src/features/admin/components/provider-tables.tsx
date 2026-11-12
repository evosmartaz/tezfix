'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import type { AdminHandymanRow } from '@tezfiks/shared';
import { DataTable, dataTableColumns, type CursorPage } from '@/components/data-table';
import { DateTime } from '@/components/date-time';
import { Money } from '@/components/money';
import { StatusBadge } from '@/components/status-badge';
import { listCompaniesAction, listCustomersAction, listHandymenAction } from '../actions';
import type { AdminCompanyRow, AdminCustomerRow } from '../types';
import { BotTag, DisplayStatusBadge, Rating, RowLink } from './ui';

type HandymenQuery = Parameters<typeof listHandymenAction>[0];
type CompaniesQuery = Parameters<typeof listCompaniesAction>[0];
type CustomersQuery = Parameters<typeof listCustomersAction>[0];

/** Ustalar list with the board 05 columns: Usta, Peşə, Reytinq, Sifariş sayı, Balans, Status, Əməliyyat. */
export function HandymenTable({ query, initialPage }: { query: HandymenQuery; initialPage?: CursorPage<AdminHandymanRow> }) {
  const t = useTranslations('panel.admin.handymen');
  const ta = useTranslations('panel.admin.common');
  const te = useTranslations('panel.admin.enums');
  const columns = useMemo(() => {
    const col = dataTableColumns<AdminHandymanRow>();
    return [
      col.accessor('lastName', {
        header: () => t('columns.name'),
        cell: (info) => {
          const h = info.row.original;
          return (
            <div>
              <div className="font-semibold whitespace-nowrap">
                {h.firstName} {h.lastName}
                {h.isBot ? <BotTag label={ta('bot')} /> : null}
                {h.isOnline ? <span className="ml-1.5 inline-block size-2 rounded-full bg-primary" title={ta('online')} /> : null}
              </div>
              <div className="text-xs text-muted-foreground">
                {h.phone}
                {h.companyName ? ` · ${h.companyName}` : ` · ${te(`handymanKind.${h.kind}`)}`}
              </div>
            </div>
          );
        },
      }),
      col.accessor('trades', {
        header: () => t('columns.trades'),
        cell: (info) => (info.getValue().length ? info.getValue().join(', ') : '—'),
      }),
      col.accessor('ratingAvg', { header: () => t('columns.rating'), cell: (info) => <Rating value={info.getValue()} /> }),
      col.accessor('completedCount', { header: () => t('columns.orders') }),
      col.accessor('walletBalance', {
        header: () => t('columns.balance'),
        cell: (info) => (info.getValue() === null ? '—' : <Money minor={info.getValue()} compact />),
      }),
      col.accessor('displayStatus', {
        header: () => t('columns.status'),
        cell: (info) => (
          <div className="flex flex-col items-start gap-1">
            <DisplayStatusBadge status={info.getValue()} />
            {info.row.original.strikes > 0 ? (
              <span className="text-xs text-danger">{t('strikesCount', { count: info.row.original.strikes })}</span>
            ) : null}
          </div>
        ),
      }),
      col.display({
        id: 'action',
        header: () => t('columns.action'),
        cell: (info) => (
          <RowLink href={`/admin/handymen/${info.row.original.id}`}>
            {info.row.original.displayStatus === 'PENDING' ? t('review') : ta('view')}
          </RowLink>
        ),
      }),
    ];
  }, [t, ta, te]);

  return (
    <DataTable
      columns={columns}
      queryKey={['admin', 'handymen', query]}
      fetchPage={(cursor) => listHandymenAction({ ...query, ...(cursor ? { cursor } : {}) })}
      initialPage={initialPage}
      getRowId={(r) => r.id}
      emptyTitle={t('empty')}
    />
  );
}

/** Şirkətlər list. */
export function CompaniesTable({ query, initialPage }: { query: CompaniesQuery; initialPage?: CursorPage<AdminCompanyRow> }) {
  const t = useTranslations('panel.admin.companies');
  const ta = useTranslations('panel.admin.common');
  const tc = useTranslations('common');
  const columns = useMemo(() => {
    const col = dataTableColumns<AdminCompanyRow>();
    return [
      col.accessor('name', {
        header: () => t('columns.name'),
        cell: (info) => (
          <div>
            <div className="font-semibold">{info.getValue()}</div>
            <div className="text-xs text-muted-foreground">
              {tc(`legalForm.${info.row.original.legalForm}`)} · {t('voen', { voen: info.row.original.voen })}
            </div>
          </div>
        ),
      }),
      col.accessor('ownerName', {
        header: () => t('columns.owner'),
        cell: (info) => (
          <div>
            <div>{info.getValue()}</div>
            <div className="text-xs text-muted-foreground">{info.row.original.ownerPhone}</div>
          </div>
        ),
      }),
      col.accessor('membersCount', { header: () => t('columns.members') }),
      col.accessor('ratingAvg', { header: () => t('columns.rating'), cell: (info) => <Rating value={info.getValue()} /> }),
      col.accessor('walletBalance', {
        header: () => t('columns.balance'),
        cell: (info) => <Money minor={info.getValue()} compact />,
      }),
      col.accessor('status', {
        header: () => t('columns.status'),
        cell: (info) => <StatusBadge family="verificationStatus" status={info.getValue()} />,
      }),
      col.accessor('createdAt', { header: () => t('columns.createdAt'), cell: (info) => <DateTime value={info.getValue()} mode="date" /> }),
      col.display({
        id: 'action',
        header: () => t('columns.action'),
        cell: (info) => (
          <RowLink href={`/admin/companies/${info.row.original.id}`}>
            {info.row.original.status === 'PENDING_REVIEW' ? t('review') : ta('view')}
          </RowLink>
        ),
      }),
    ];
  }, [t, ta, tc]);

  return (
    <DataTable
      columns={columns}
      queryKey={['admin', 'companies', query]}
      fetchPage={(cursor) => listCompaniesAction({ ...query, ...(cursor ? { cursor } : {}) })}
      initialPage={initialPage}
      getRowId={(r) => r.id}
      emptyTitle={t('empty')}
    />
  );
}

/** Müştərilər list. */
export function CustomersTable({ query, initialPage }: { query: CustomersQuery; initialPage?: CursorPage<AdminCustomerRow> }) {
  const t = useTranslations('panel.admin.customers');
  const ta = useTranslations('panel.admin.common');
  const tc = useTranslations('common');
  const columns = useMemo(() => {
    const col = dataTableColumns<AdminCustomerRow>();
    return [
      col.accessor('name', {
        header: () => t('columns.name'),
        cell: (info) => (
          <div>
            <div className="font-semibold">{info.getValue()}</div>
            <div className="text-xs text-muted-foreground">{info.row.original.phone}</div>
          </div>
        ),
      }),
      col.accessor('type', {
        header: () => t('columns.type'),
        cell: (info) => (
          <div>
            <div>{tc(`customerType.${info.getValue()}`)}</div>
            {info.row.original.companyName ? (
              <div className="text-xs text-muted-foreground">{info.row.original.companyName}</div>
            ) : null}
          </div>
        ),
      }),
      col.accessor('requestsCount', { header: () => t('columns.requests') }),
      col.accessor('ratingAvg', { header: () => t('columns.rating'), cell: (info) => <Rating value={info.getValue()} /> }),
      col.accessor('walletBalance', {
        header: () => t('columns.balance'),
        cell: (info) => <Money minor={info.getValue()} colored />,
      }),
      col.accessor('userStatus', {
        header: () => t('columns.status'),
        cell: (info) => <StatusBadge family="userStatus" status={info.getValue()} />,
      }),
      col.accessor('createdAt', { header: () => t('columns.createdAt'), cell: (info) => <DateTime value={info.getValue()} mode="date" /> }),
      col.display({
        id: 'action',
        header: () => t('columns.action'),
        cell: (info) => <RowLink href={`/admin/customers/${info.row.original.id}`}>{ta('view')}</RowLink>,
      }),
    ];
  }, [t, ta, tc]);

  return (
    <DataTable
      columns={columns}
      queryKey={['admin', 'customers', query]}
      fetchPage={(cursor) => listCustomersAction({ ...query, ...(cursor ? { cursor } : {}) })}
      initialPage={initialPage}
      getRowId={(r) => r.id}
      emptyTitle={t('empty')}
    />
  );
}
