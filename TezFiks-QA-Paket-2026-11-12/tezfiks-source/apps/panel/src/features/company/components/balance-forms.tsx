'use client';

import { useId, useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { CreditCard, ExternalLink, Wallet } from 'lucide-react';
import type { LedgerTxView, PayoutMethodType, PayoutMethodView } from '@tezfiks/shared';
import { DataTable, dataTableColumns, type CursorPage } from '@/components/data-table';
import { DateTime } from '@/components/date-time';
import { FormError, FormField } from '@/components/form-field';
import { Money } from '@/components/money';
import { toast } from '@/components/toaster';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/features/admin/components/ui';
import { moneyText } from '@/lib/format';
import { useSocketEvent } from '@/lib/realtime/realtime-provider';
import { cn } from '@/lib/utils';
import { listTransactionsAction, setPayoutMethodAction, topupAction } from '../actions';
import { isCompanyWalletEvent } from '../dispatch';
import { TOPUP_PRESETS, pageVersion, payoutMethodBody, requestNo, topupBody, type PayoutMethodForm } from '../mappers';
import { newKey } from './ui';

// ---------------------------------------------------------------------------------------------- top-up ---

/**
 * "+ Balansı artır": creates a test-mode payment intent and opens its checkout in a new tab. The tab is opened
 * synchronously on click (popup blockers), then pointed at the checkout URL; when the browser blocked it, a link is shown.
 */
export function TopupForm({ companyId }: { companyId: string }) {
  const t = useTranslations('panel.company.balance.topup');
  const locale = useLocale();
  const router = useRouter();
  const id = useId();
  const [amount, setAmount] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checkout, setCheckout] = useState<string | null>(null);
  const [key, setKey] = useState(() => newKey('topup'));

  // The wallet changes when the checkout completes: refresh the page data.
  useSocketEvent('wallet:updated', (p) => {
    if (isCompanyWalletEvent(p, companyId)) router.refresh();
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    const built = topupBody(amount);
    if (!built.ok) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setError(null);
    setBusy(true);
    let tab: Window | null = null;
    try {
      tab = typeof window !== 'undefined' ? window.open('', '_blank') : null;
      if (tab) tab.opener = null;
    } catch {
      tab = null;
    }
    try {
      const r = await topupAction(companyId, built.body.amount, key);
      if (r.ok) {
        setCheckout(r.data.checkoutUrl);
        setKey(newKey('topup'));
        if (tab) {
          tab.location.href = r.data.checkoutUrl;
          toast.success(t('opened'));
        } else {
          toast(t('popupBlocked'));
        }
      } else {
        tab?.close();
        setError(r.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <FormError message={error} />
      <div className="flex flex-wrap gap-2">
        {TOPUP_PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setAmount(String(p / 100))}
            className={cn(
              'rounded-full border border-border px-3 py-1 text-xs font-semibold hover:border-primary',
              amount === String(p / 100) && 'border-primary bg-primary/10 text-primary-strong',
            )}
          >
            {moneyText(p, locale, { compact: true })}
          </button>
        ))}
      </div>
      <FormField label={t('amount')} htmlFor={`${id}-amount`} error={invalid ? t('amountError') : undefined} hint={t('amountHint')}>
        <Input
          id={`${id}-amount`}
          inputMode="decimal"
          placeholder="50"
          value={amount}
          aria-invalid={invalid || undefined}
          onChange={(e) => setAmount(e.target.value)}
        />
      </FormField>
      <Button type="submit" loading={busy}>
        <Wallet />
        {t('submit')}
      </Button>
      {checkout ? (
        <a
          href={checkout}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
        >
          <ExternalLink className="size-4" aria-hidden />
          {t('openCheckout')}
        </a>
      ) : null}
    </form>
  );
}

// ------------------------------------------------------------------------------------------ transactions ---

export function TransactionsTable({
  companyId,
  initialPage,
}: {
  companyId: string;
  initialPage?: CursorPage<LedgerTxView>;
}) {
  const t = useTranslations('panel.company.balance.transactions');
  const tc = useTranslations('common');
  const columns = useMemo(() => {
    const col = dataTableColumns<LedgerTxView>();
    return [
      col.accessor('createdAt', { header: () => t('columns.date'), cell: (c) => <DateTime value={c.getValue()} /> }),
      col.accessor('kind', {
        header: () => t('columns.kind'),
        cell: (c) => (
          <div>
            <div>{tc.has(`ledgerTxKind.${c.getValue()}`) ? tc(`ledgerTxKind.${c.getValue()}`) : c.getValue()}</div>
            {c.row.original.memo ? <div className="text-xs text-muted-foreground">{c.row.original.memo}</div> : null}
          </div>
        ),
      }),
      col.accessor((tx) => tx.requestNumber ?? tx.projectNumber, {
        id: 'ref',
        header: () => t('columns.ref'),
        cell: (c) =>
          c.row.original.requestNumber !== null
            ? requestNo(c.row.original.requestNumber)
            : c.row.original.projectNumber !== null
              ? t('project', { number: c.row.original.projectNumber })
              : '—',
      }),
      col.accessor('amount', { header: () => t('columns.amount'), cell: (c) => <Money minor={c.getValue()} colored sign /> }),
      col.accessor('balanceAfter', { header: () => t('columns.balanceAfter'), cell: (c) => <Money minor={c.getValue()} /> }),
    ];
  }, [t, tc]);
  return (
    <DataTable
      columns={columns}
      queryKey={['company', companyId, 'transactions', pageVersion(initialPage, (tx) => tx.id)]}
      fetchPage={(cursor) => listTransactionsAction(companyId, { limit: 20, ...(cursor ? { cursor } : {}) })}
      initialPage={initialPage}
      getRowId={(tx) => tx.id}
      emptyTitle={t('empty')}
    />
  );
}

// ------------------------------------------------------------------------------------------ payout card ---

export function PayoutMethodFormView({ companyId, current }: { companyId: string; current: PayoutMethodView | null }) {
  const t = useTranslations('panel.company.balance.payoutMethod');
  const router = useRouter();
  const id = useId();
  const [form, setForm] = useState<PayoutMethodForm>({ type: current?.type ?? 'CARD', number: '', holderName: current?.holderName ?? '' });
  const [field, setField] = useState<'number' | 'holderName' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const built = payoutMethodBody(form);
    if (!built.ok) {
      setField(built.field);
      return;
    }
    setField(null);
    setError(null);
    setBusy(true);
    try {
      const r = await setPayoutMethodAction(companyId, built.body);
      if (r.ok) {
        toast.success(t('saved'));
        setForm((f) => ({ ...f, number: '' }));
        router.refresh();
      } else {
        setError(r.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      {current ? (
        <p className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm" data-testid="payout-current">
          <CreditCard className="size-4" aria-hidden />
          {t(`type.${current.type}`)} {current.maskedNumber} · {current.holderName}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">{t('none')}</p>
      )}
      <FormError message={error} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <FormField label={t('typeLabel')} htmlFor={`${id}-type`}>
          <Select id={`${id}-type`} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as PayoutMethodType })}>
            <option value="CARD">{t('type.CARD')}</option>
            <option value="IBAN">{t('type.IBAN')}</option>
          </Select>
        </FormField>
        <FormField
          label={form.type === 'CARD' ? t('cardNumber') : t('iban')}
          htmlFor={`${id}-number`}
          error={field === 'number' ? t('numberError') : undefined}
          className="sm:col-span-2"
        >
          <Input
            id={`${id}-number`}
            inputMode={form.type === 'CARD' ? 'numeric' : 'text'}
            autoComplete="off"
            placeholder={form.type === 'CARD' ? '4169 7388 1234 5670' : 'AZ21 NABZ 0000 0000 1370 1000 1944'}
            value={form.number}
            aria-invalid={field === 'number' || undefined}
            onChange={(e) => setForm({ ...form, number: e.target.value })}
          />
        </FormField>
      </div>
      <FormField label={t('holder')} htmlFor={`${id}-holder`} error={field === 'holderName' ? t('holderError') : undefined}>
        <Input
          id={`${id}-holder`}
          value={form.holderName}
          aria-invalid={field === 'holderName' || undefined}
          onChange={(e) => setForm({ ...form, holderName: e.target.value })}
        />
      </FormField>
      <p className="text-xs text-muted-foreground">{t('hint')}</p>
      <div>
        <Button type="submit" loading={busy}>
          {t('save')}
        </Button>
      </div>
    </form>
  );
}
