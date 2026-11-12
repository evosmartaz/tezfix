'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import type { ProAssignment } from '@tezfiks/shared';
import { DataTable, dataTableColumns, type CursorPage } from '@/components/data-table';
import { DateTime } from '@/components/date-time';
import { Money } from '@/components/money';
import { StatusBadge } from '@/components/status-badge';
import { listAssignmentsAction } from '../actions';
import { customerShortName, pageVersion, personName, requestNo, type AssignmentScope } from '../mappers';

/** Company jobs (Sifarişlər): server-paginated, no phones in the list (spec §4.4). */
export function OrdersTable({
  companyId,
  scope,
  initialPage,
}: {
  companyId: string;
  scope: AssignmentScope;
  initialPage?: CursorPage<ProAssignment>;
}) {
  const t = useTranslations('panel.company.orders');
  const columns = useMemo(() => {
    const col = dataTableColumns<ProAssignment>();
    return [
      col.accessor('requestNumber', {
        header: () => t('columns.number'),
        cell: (c) => <span className="font-semibold">{requestNo(c.getValue())}</span>,
      }),
      col.accessor((a) => a.category.name, {
        id: 'category',
        header: () => t('columns.category'),
        cell: (c) => (
          <div>
            <div>{c.getValue()}</div>
            <div className="max-w-56 truncate text-xs text-muted-foreground">{c.row.original.address.district ?? c.row.original.address.formatted}</div>
          </div>
        ),
      }),
      col.accessor((a) => personName(a.worker), { id: 'worker', header: () => t('columns.worker') }),
      col.accessor((a) => customerShortName(a.customer), {
        id: 'customer',
        header: () => t('columns.customer'),
      }),
      col.accessor('status', {
        header: () => t('columns.status'),
        cell: (c) => <StatusBadge family="assignmentStatus" status={c.getValue()} />,
      }),
      col.accessor('acceptedAt', {
        header: () => t('columns.acceptedAt'),
        cell: (c) => <DateTime value={c.getValue()} />,
      }),
      col.accessor((a) => a.price?.total ?? null, {
        id: 'price',
        header: () => t('columns.price'),
        cell: (c) => <Money minor={c.getValue()} />,
      }),
      col.accessor((a) => a.fee?.amount ?? null, {
        id: 'fee',
        header: () => t('columns.fee'),
        cell: (c) => <Money minor={c.getValue()} />,
      }),
    ];
  }, [t]);
  return (
    <DataTable
      columns={columns}
      queryKey={['company', companyId, 'assignments', scope, pageVersion(initialPage, (a) => `${a.id}:${a.status}`)]}
      fetchPage={(cursor) => listAssignmentsAction(companyId, { scope, limit: 20, ...(cursor ? { cursor } : {}) })}
      initialPage={initialPage}
      getRowId={(a) => a.id}
      rowHref={(a) => `/company/${companyId}/orders/${a.id}`}
      emptyTitle={scope === 'active' ? t('emptyActive') : t('emptyHistory')}
    />
  );
}
