import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { AdminAssignmentRow, AdminLedgerTx, WalletSummary } from '@tezfiks/shared';
import type { AdminStrike } from '../types';
import { DateTime } from '@/components/date-time';
import { EmptyState } from '@/components/states';
import { Money } from '@/components/money';
import { StatusBadge } from '@/components/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requestNo } from '../mappers';

/** Assignments with both phones (admins may see them; spec §4.4 applies to the other party only). */
export function AssignmentsTable({ rows, showRequest = false }: { rows: AdminAssignmentRow[]; showRequest?: boolean }) {
  const t = useTranslations('panel.admin.assignments');
  const tc = useTranslations('common');
  const te = useTranslations('panel.admin.enums');
  if (rows.length === 0) return <EmptyState title={t('empty')} />;
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {showRequest ? <TableHead>{t('request')}</TableHead> : null}
          <TableHead>{t('provider')}</TableHead>
          <TableHead>{t('customer')}</TableHead>
          <TableHead>{t('status')}</TableHead>
          <TableHead>{t('acceptedAt')}</TableHead>
          <TableHead>{t('finishedAt')}</TableHead>
          <TableHead>{t('price')}</TableHead>
          <TableHead>{t('fee')}</TableHead>
          <TableHead>{t('contact')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((a) => (
          <TableRow key={a.id}>
            {showRequest ? (
              <TableCell className="font-semibold">
                <Link href={`/admin/orders/${a.requestId}`} className="hover:underline">
                  {requestNo(a.requestNumber)}
                </Link>
              </TableCell>
            ) : null}
            <TableCell>
              <div className="font-medium">{a.providerName}</div>
              <div className="text-xs text-muted-foreground">
                {a.providerPhone}
                {a.companyName ? ` · ${a.companyName}` : ` · ${te(`providerType.${a.providerType}`)}`}
              </div>
            </TableCell>
            <TableCell>
              <div className="font-medium">{a.customerName}</div>
              <div className="text-xs text-muted-foreground">{a.customerPhone}</div>
            </TableCell>
            <TableCell>
              <StatusBadge family="assignmentStatus" status={a.status} />
              {a.cancelledBy ? (
                <div className="mt-1 text-xs text-muted-foreground">
                  {t('cancelledBy', { actor: te(`actorSide.${a.cancelledBy}`) })}
                </div>
              ) : null}
            </TableCell>
            <TableCell>
              <DateTime value={a.acceptedAt} />
              {a.etaSec !== null ? (
                <div className="text-xs text-muted-foreground">{t('eta', { minutes: Math.max(1, Math.round(a.etaSec / 60)) })}</div>
              ) : null}
            </TableCell>
            <TableCell>
              <DateTime value={a.completedAt ?? a.cancelledAt} />
            </TableCell>
            <TableCell>
              {a.price ? (
                <div>
                  <Money minor={a.price.total} />
                  <div className="text-xs text-muted-foreground">
                    {a.paymentMethod ? tc(`paymentMethod.${a.paymentMethod}`) : '—'}
                  </div>
                </div>
              ) : (
                '—'
              )}
            </TableCell>
            <TableCell>
              {a.fee ? (
                <div>
                  <Money minor={a.fee.amount} compact />
                  <div className="text-xs text-muted-foreground">
                    {a.fee.refunded ? t('feeRefunded') : a.fee.captured ? t('feeCaptured') : t('feeHeld')}
                  </div>
                </div>
              ) : (
                '—'
              )}
            </TableCell>
            <TableCell>{a.contactUnlockedAt ? <DateTime value={a.contactUnlockedAt} mode="time" /> : t('locked')}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Double-entry lines of a ledger transaction: owner (account kind), signed amount, balance after. */
export function LedgerEntries({ tx }: { tx: AdminLedgerTx }) {
  const te = useTranslations('panel.admin.enums');
  return (
    <ul className="flex flex-col gap-0.5 text-xs">
      {tx.entries.map((e, i) => (
        <li key={`${e.accountId}-${i}`} className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium text-foreground">{e.ownerName}</span>
          <span className="text-muted-foreground">{te(`ledgerAccountKind.${e.accountKind}`)}</span>
          <Money minor={e.amount} colored sign />
          <span className="text-muted-foreground">
            → <Money minor={e.balanceAfter} />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Ledger transactions of one entity (request detail). */
export function LedgerTable({ rows }: { rows: AdminLedgerTx[] }) {
  const t = useTranslations('panel.admin.ledger');
  const tc = useTranslations('common');
  if (rows.length === 0) return <EmptyState title={t('empty')} />;
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>{t('createdAt')}</TableHead>
          <TableHead>{t('kind')}</TableHead>
          <TableHead>{t('entries')}</TableHead>
          <TableHead>{t('memo')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((tx) => (
          <TableRow key={tx.id}>
            <TableCell>
              <DateTime value={tx.createdAt} />
            </TableCell>
            <TableCell>{tc(`ledgerTxKind.${tx.kind}`)}</TableCell>
            <TableCell>
              <LedgerEntries tx={tx} />
            </TableCell>
            <TableCell className="max-w-64 text-xs text-muted-foreground">
              {tx.memo ?? '—'}
              {tx.actor ? <div>{tx.actor}</div> : null}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Strikes (spec 4.7) with cleared ones greyed out. */
export function StrikesList({ strikes }: { strikes: AdminStrike[] }) {
  const t = useTranslations('panel.admin.strikes');
  if (strikes.length === 0) return <p className="text-sm text-muted-foreground">{t('empty')}</p>;
  return (
    <ul className="flex flex-col divide-y divide-border">
      {strikes.map((s) => (
        <li key={s.id} className={s.clearedAt ? 'py-2 text-muted-foreground line-through' : 'py-2'}>
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span>
              {s.reason}
              {s.requestNumber !== null ? <span className="text-muted-foreground"> · {requestNo(s.requestNumber)}</span> : null}
            </span>
            <DateTime value={s.createdAt} className="text-xs" />
          </div>
          {s.clearedAt ? (
            <div className="text-xs no-underline">
              {t('cleared')} <DateTime value={s.clearedAt} />
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** Wallet balances (posted / held / available) plus earnings when the owner has them. */
export function WalletSummaryView({ wallet, earnings }: { wallet: WalletSummary | null; earnings?: number | null }) {
  const t = useTranslations('panel.admin.wallet');
  if (!wallet) return <p className="text-sm text-muted-foreground">{t('none')}</p>;
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
      <div>
        <dt className="text-xs text-muted-foreground">{t('available')}</dt>
        <dd className="text-xl font-bold">
          <Money minor={wallet.available} colored />
        </dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">{t('posted')}</dt>
        <dd>
          <Money minor={wallet.posted} />
        </dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">{t('held')}</dt>
        <dd>
          <Money minor={wallet.held} />
        </dd>
      </div>
      {earnings !== undefined && earnings !== null ? (
        <div>
          <dt className="text-xs text-muted-foreground">{t('earnings')}</dt>
          <dd>
            <Money minor={earnings} />
          </dd>
        </div>
      ) : null}
      {wallet.isDebt || wallet.lowBalance ? (
        <div className="col-span-2 text-xs font-medium text-danger">{wallet.isDebt ? t('debt') : t('lowBalance')}</div>
      ) : null}
    </dl>
  );
}
