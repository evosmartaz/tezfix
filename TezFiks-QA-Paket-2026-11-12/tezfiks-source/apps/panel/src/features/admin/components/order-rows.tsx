import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { AdminRequestRow } from '@tezfiks/shared';
import { DateTime } from '@/components/date-time';
import { EmptyState } from '@/components/states';
import { Money } from '@/components/money';
import { StatusBadge } from '@/components/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { orderDisplayStatus, requestNo } from '../mappers';
import { BotTag } from './ui';

/** Order status pill (assignment status while a handyman is on the job). */
export function OrderStatus({ row }: { row: Pick<AdminRequestRow, 'status' | 'assignmentStatus'> }) {
  const s = orderDisplayStatus(row);
  return s.family === 'assignmentStatus' ? (
    <StatusBadge family="assignmentStatus" status={s.status} />
  ) : (
    <StatusBadge family="requestStatus" status={s.status} />
  );
}

/** Static order list ("Son sifarişlər" on the dashboard, a customer's recent requests). */
export function OrderRows({ rows, showDate = false }: { rows: AdminRequestRow[]; showDate?: boolean }) {
  const t = useTranslations('panel.admin.orders');
  const tc = useTranslations('panel.admin.common');
  if (rows.length === 0) return <EmptyState title={t('empty')} />;
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>{t('columns.number')}</TableHead>
          <TableHead>{t('columns.customer')}</TableHead>
          <TableHead>{t('columns.provider')}</TableHead>
          <TableHead>{t('columns.service')}</TableHead>
          <TableHead>{t('columns.status')}</TableHead>
          <TableHead>{t('columns.fee')}</TableHead>
          {showDate ? <TableHead>{t('columns.createdAt')}</TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell className="font-semibold">
              <Link href={`/admin/orders/${row.id}`} className="hover:underline">
                {requestNo(row.number)}
              </Link>
              {row.isBot ? <BotTag label={tc('bot')} /> : null}
            </TableCell>
            <TableCell>{row.customerName}</TableCell>
            <TableCell>{row.providerName ?? '—'}</TableCell>
            <TableCell>{row.categoryName}</TableCell>
            <TableCell>
              <OrderStatus row={row} />
            </TableCell>
            <TableCell>{row.fee > 0 ? <Money minor={row.fee} compact /> : '—'}</TableCell>
            {showDate ? (
              <TableCell>
                <DateTime value={row.createdAt} />
              </TableCell>
            ) : null}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
