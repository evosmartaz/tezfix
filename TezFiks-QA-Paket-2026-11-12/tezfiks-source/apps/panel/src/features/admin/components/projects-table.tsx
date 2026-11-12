'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { DataTable, dataTableColumns, type CursorPage } from '@/components/data-table';
import { DateTime } from '@/components/date-time';
import { StatusBadge } from '@/components/status-badge';
import { listProjectsAction } from '../actions';
import type { AdminProjectRow } from '../types';
import { RowLink } from './ui';

type ProjectsQuery = Parameters<typeof listProjectsAction>[0];

/** Layihələr (B2B quote requests). */
export function ProjectsTable({ query, initialPage }: { query: ProjectsQuery; initialPage?: CursorPage<AdminProjectRow> }) {
  const t = useTranslations('panel.admin.projects');
  const ta = useTranslations('panel.admin.common');
  const columns = useMemo(() => {
    const col = dataTableColumns<AdminProjectRow>();
    return [
      col.accessor('number', { header: () => t('columns.number'), cell: (info) => <span className="font-semibold">P-{info.getValue()}</span> }),
      col.accessor('customerName', { header: () => t('columns.customer') }),
      col.accessor('categoryName', { header: () => t('columns.category') }),
      col.accessor('workersNeeded', { header: () => t('columns.workers') }),
      col.accessor('dateFrom', {
        header: () => t('columns.dates'),
        cell: (info) => (
          <span className="whitespace-nowrap">
            {info.getValue()} – {info.row.original.dateTo}
          </span>
        ),
      }),
      col.accessor('quotesCount', { header: () => t('columns.quotes') }),
      col.accessor('status', { header: () => t('columns.status'), cell: (info) => <StatusBadge family="projectStatus" status={info.getValue()} /> }),
      col.accessor('createdAt', { header: () => t('columns.createdAt'), cell: (info) => <DateTime value={info.getValue()} mode="date" /> }),
      col.display({
        id: 'action',
        header: () => t('columns.action'),
        cell: (info) => <RowLink href={`/admin/projects/${info.row.original.id}`}>{ta('view')}</RowLink>,
      }),
    ];
  }, [t, ta]);
  return (
    <DataTable
      columns={columns}
      queryKey={['admin', 'projects', query]}
      fetchPage={(cursor) => listProjectsAction({ ...query, ...(cursor ? { cursor } : {}) })}
      initialPage={initialPage}
      getRowId={(r) => r.id}
      rowHref={(r) => `/admin/projects/${r.id}`}
      emptyTitle={t('empty')}
    />
  );
}
