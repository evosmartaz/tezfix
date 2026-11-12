'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { DataTable, dataTableColumns, type CursorPage } from '@/components/data-table';
import { DateTime } from '@/components/date-time';
import { listAuditAction } from '../actions';
import { jsonPreview } from '../mappers';
import type { AuditRow } from '../types';

type AuditQuery = Parameters<typeof listAuditAction>[0];

function Snapshot({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-muted-foreground">{label}</summary>
      <pre className="mt-1 max-h-60 max-w-md overflow-auto rounded bg-muted p-2">{jsonPreview(value)}</pre>
    </details>
  );
}

/** Audit log (every admin mutation with before / after snapshots). */
export function AuditTable({ query, initialPage }: { query: AuditQuery; initialPage?: CursorPage<AuditRow> }) {
  const t = useTranslations('panel.admin.audit');
  const te = useTranslations('panel.admin.enums.auditActor');
  const columns = useMemo(() => {
    const col = dataTableColumns<AuditRow>();
    return [
      col.accessor('at', { header: () => t('columns.at'), cell: (info) => <DateTime value={info.getValue()} /> }),
      col.accessor('actorName', {
        header: () => t('columns.actor'),
        cell: (info) => (
          <div>
            <div className="font-medium">{info.getValue() ?? '—'}</div>
            <div className="text-xs text-muted-foreground">{te(info.row.original.actorType)}</div>
          </div>
        ),
      }),
      col.accessor('action', { header: () => t('columns.action'), cell: (info) => <code className="text-xs">{info.getValue()}</code> }),
      col.accessor('entityType', {
        header: () => t('columns.entity'),
        cell: (info) => (
          <div>
            <div>{info.getValue()}</div>
            {info.row.original.entityId ? (
              <div className="font-mono text-[11px] text-muted-foreground">{info.row.original.entityId}</div>
            ) : null}
          </div>
        ),
      }),
      col.display({
        id: 'changes',
        header: () => t('columns.changes'),
        cell: (info) => (
          <div className="flex flex-col gap-1">
            <Snapshot label={t('before')} value={info.row.original.before} />
            <Snapshot label={t('after')} value={info.row.original.after} />
          </div>
        ),
      }),
      col.accessor('ip', { header: () => t('columns.ip'), cell: (info) => <span className="text-xs">{info.getValue() ?? '—'}</span> }),
    ];
  }, [t, te]);
  return (
    <DataTable
      columns={columns}
      queryKey={['admin', 'audit', query]}
      fetchPage={(cursor) => listAuditAction({ ...query, ...(cursor ? { cursor } : {}) })}
      initialPage={initialPage}
      getRowId={(r) => r.id}
      emptyTitle={t('empty')}
    />
  );
}
