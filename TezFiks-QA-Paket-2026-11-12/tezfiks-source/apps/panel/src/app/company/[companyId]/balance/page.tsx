import { getTranslations } from 'next-intl/server';
import { api } from '@tezfiks/shared';
import { DateTime } from '@/components/date-time';
import { Money } from '@/components/money';
import { PageHeader } from '@/components/page-header';
import { StatCard } from '@/components/stat-card';
import { StatusBadge } from '@/components/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Section } from '@/features/admin/components/ui';
import { PayoutMethodFormView, TopupForm, TransactionsTable } from '@/features/company/components/balance-forms';
import { CompanyLiveRefresh } from '@/features/company/components/live-refresh';
import { CompanyLoadError } from '@/features/company/components/load-error';
import { Note } from '@/features/company/components/ui';
import { optional, section } from '@/features/company/server';
import { moneyText } from '@/lib/format';
import { requireManager } from '@/lib/session/server';

/** Balans: company wallet, top-up (test checkout in a new tab), transactions, card earnings, payouts, payout card. */
export default async function CompanyBalancePage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { companyId } = await params;
  const sp = await searchParams;
  const ctx = await requireManager(companyId);
  const { locale } = ctx;
  const p = { params: { companyId } };
  const [wallet, transactions, earnings, payout] = await Promise.all([
    section(ctx.api.call(api.company.wallet, p), locale),
    section(ctx.api.call(api.company.walletTransactions, { ...p, query: { limit: 20 } }), locale),
    section(ctx.api.call(api.company.earnings, p), locale),
    optional(ctx.api.call(api.company.getPayoutMethod, p)),
  ]);
  const t = await getTranslations('panel.company.balance');
  const payoutMethod = payout?.method ?? (earnings.ok ? earnings.data.payoutMethod : null);

  return (
    <div className="flex flex-col gap-6">
      <CompanyLiveRefresh companyId={companyId} topics={['wallet']} />
      <PageHeader title={t('title')} description={t('subtitle')} />
      {sp.topup === 'done' ? <Note tone="info">{t('topup.returned')}</Note> : null}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Section title={t('wallet.title')} className="xl:col-span-2">
          {wallet.ok ? (
            <div className="flex flex-col gap-4">
              {wallet.data.lowBalance ? <Note tone="danger">{t('wallet.lowBalance')}</Note> : null}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <StatCard
                  label={t('wallet.available')}
                  value={moneyText(wallet.data.available, locale)}
                  tone={wallet.data.lowBalance ? 'danger' : 'primary'}
                />
                <StatCard label={t('wallet.held')} value={moneyText(wallet.data.held, locale)} hint={t('wallet.heldHint')} />
                <StatCard label={t('wallet.posted')} value={moneyText(wallet.data.posted, locale)} />
              </div>
            </div>
          ) : (
            <CompanyLoadError error={wallet} />
          )}
        </Section>
        <Section title={t('topup.title')}>
          <TopupForm companyId={companyId} />
        </Section>
      </div>

      <Section title={t('transactions.title')} bodyClassName="p-0">
        {transactions.ok ? (
          <TransactionsTable companyId={companyId} initialPage={transactions.data} />
        ) : (
          <CompanyLoadError error={transactions} className="border-0" />
        )}
      </Section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Section title={t('earnings.title')}>
          {earnings.ok ? (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <StatCard label={t('earnings.balance')} value={moneyText(earnings.data.earningsBalance, locale)} tone="primary" hint={t('earnings.balanceHint')} />
                <StatCard label={t('earnings.pending')} value={moneyText(earnings.data.pendingPayouts, locale)} />
              </div>
              <div className="rounded-md bg-muted p-3 text-sm">
                <div className="mb-1 font-semibold">{t('earnings.thisWeek')}</div>
                <div>
                  {t('earnings.card', {
                    count: earnings.data.thisWeek.cardJobs,
                    amount: moneyText(earnings.data.thisWeek.cardTotal, locale),
                  })}
                </div>
                <div>
                  {t('earnings.cash', {
                    count: earnings.data.thisWeek.cashJobs,
                    amount: moneyText(earnings.data.thisWeek.cashTotal, locale),
                  })}
                </div>
                <div>{t('earnings.tips', { amount: moneyText(earnings.data.thisWeek.tips, locale) })}</div>
              </div>
              <h3 className="text-sm font-semibold">{t('payouts.title')}</h3>
              {earnings.data.payouts.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('payouts.empty')}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>{t('payouts.period')}</TableHead>
                      <TableHead>{t('payouts.amount')}</TableHead>
                      <TableHead>{t('payouts.status')}</TableHead>
                      <TableHead>{t('payouts.paidAt')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {earnings.data.payouts.map((po) => (
                      <TableRow key={po.id}>
                        <TableCell>
                          <DateTime value={po.periodStart} mode="date" /> – <DateTime value={po.periodEnd} mode="date" />
                        </TableCell>
                        <TableCell>
                          <Money minor={po.amount} />
                        </TableCell>
                        <TableCell>
                          <StatusBadge family="payoutStatus" status={po.status} />
                          {po.failureReason ? <div className="text-xs text-danger">{po.failureReason}</div> : null}
                        </TableCell>
                        <TableCell>
                          <DateTime value={po.paidAt} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <p className="text-xs text-muted-foreground">{t('payouts.hint')}</p>
            </div>
          ) : (
            <CompanyLoadError error={earnings} />
          )}
        </Section>
        <Section title={t('payoutMethod.title')}>
          <PayoutMethodFormView companyId={companyId} current={payoutMethod} />
        </Section>
      </div>
    </div>
  );
}
