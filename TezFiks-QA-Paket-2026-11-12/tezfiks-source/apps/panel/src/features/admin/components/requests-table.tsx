'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import type { AdminRequestRow } from '@tezfiks/shared';
import { DataTable, dataTableColumns, type CursorPage } from '@/components/data-table';
import { DateTime } from '@/components/date-time';
import { Money } from '@/components/money';
import { listRequestsAction } from '../actions';
import { requestNo } from '../mappers';
import { OrderStatus } from './order-rows';
import { BotTag } from './ui';

type RequestsQuery = Parameters<typeof listRequestsAction>[0];

/** Sifarişlər list (server pagination by cursor; filters come from the URL). */
export function RequestsTable({ query, initialPage }: { query: RequestsQuery; initialPage?: CursorPage<AdminRequestRow> }) {
  const t = useTranslations('panel.admin.orders');
  const tc = useTranslations('common');
  const ta = useTranslations('panel.admin.common');
  const columns = useMemo(() => {
    const col = dataTableColumns<AdminRequestRow>();
    return [
      col.accessor('number', {
        header: () => t('columns.number'),
        cell: (info) => (
          <span className="font-semibold whitespace-nowrap">
            {requestNo(info.getValue())}
            {info.row.original.isBot ? <BotTag label={ta('bot')} /> : null}
          </span>
        ),
      }),
      col.accessor('customerName', { header: () => t('columns.customer') }),
      col.accessor('providerName', { header: () => t('columns.provider'), cell: (info) => info.getValue() ?? '—' }),
      col.accessor('categoryName', { header: () => t('columns.service') }),
      col.accessor('timing', {
        header: () => t('columns.timing'),
        cell: (info) => tc(`timing.${info.getValue()}`),
      }),
      col.accessor('slots', { header: () => t('columns.slots') }),
      col.accessor('status', {
        header: () => t('columns.status'),
        cell: (info) => <OrderStatus row={info.row.original} />,
      }),
      col.accessor('fee', {
        header: () => t('columns.fee'),
        cell: (info) => (info.getValue() > 0 ? <Money minor={info.getValue()} compact /> : '—'),
      }),
      col.accessor('createdAt', {
        header: () => t('columns.createdAt'),
        cell: (info) => <DateTime value={info.getValue()} />,
      }),
    ];
  }, [t, tc, ta]);

  return (
    <DataTable
      columns={columns}
      queryKey={['admin', 'requests', query]}
      fetchPage={(cursor) => listRequestsAction({ ...query, ...(cursor ? { cursor } : {}) })}
      initialPage={initialPage}
      getRowId={(r) => r.id}
      rowHref={(r) => `/admin/orders/${r.id}`}
      emptyTitle={t('empty')}
    />
  );
}
