'use client';

import { useId, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Wallet } from 'lucide-react';
import { FormError, FormField } from '@/components/form-field';
import { toast } from '@/components/toaster';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/input';
import { adjustWalletAction } from '../actions';
import { walletAdjustBody, type WalletAdjustForm, type WalletOwnerType } from '../mappers';
import { Select } from './ui';

function newKey(): string {
  const c = globalThis.crypto as Crypto | undefined;
  return c?.randomUUID ? c.randomUUID() : `adj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

const EMPTY: WalletAdjustForm = { direction: 'credit', amount: '', account: 'WALLET', reason: '' };

/**
 * Manual wallet adjustment ("Balans artır" / deduct) for a customer account, solo handyman or company. One idempotency
 * key per opened dialog: a double click or a retry after a network error posts the adjustment once.
 */
export function WalletAdjustDialog({
  owner,
  revalidate,
  allowEarnings = false,
}: {
  owner: { type: WalletOwnerType; id: string };
  /** Admin page to refresh after the adjustment. */
  revalidate?: string;
  /** Offer the EARNINGS account (handymen and companies). */
  allowEarnings?: boolean;
}) {
  const t = useTranslations('panel.admin.wallet');
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<WalletAdjustForm>(EMPTY);
  const [fieldError, setFieldError] = useState<'amount' | 'reason' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(newKey);

  function change(open: boolean) {
    if (busy) return;
    setOpen(open);
    if (open) {
      setForm(EMPTY);
      setFieldError(null);
      setError(null);
      setKey(newKey());
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const built = walletAdjustBody(form, owner);
    if (!built.ok) {
      setFieldError(built.field);
      return;
    }
    setFieldError(null);
    setError(null);
    setBusy(true);
    try {
      const result = await adjustWalletAction(built.body, key, revalidate);
      if (result.ok) {
        toast.success(t('success'));
        setOpen(false);
        router.refresh();
      } else {
        setError(result.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Wallet />
        {t('button')}
      </DialogTrigger>
      <DialogContent closeLabel={t('close')}>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('description')}</DialogDescription>
          </DialogHeader>
          <FormError message={error} />
          <div className="grid grid-cols-2 gap-3">
            <FormField label={t('direction')} htmlFor={`${id}-dir`}>
              <Select
                id={`${id}-dir`}
                value={form.direction}
                onChange={(e) => setForm({ ...form, direction: e.target.value as WalletAdjustForm['direction'] })}
              >
                <option value="credit">{t('credit')}</option>
                <option value="debit">{t('debit')}</option>
              </Select>
            </FormField>
            <FormField label={t('amount')} htmlFor={`${id}-amount`} error={fieldError === 'amount' ? t('amountError') : undefined}>
              <Input
                id={`${id}-amount`}
                inputMode="decimal"
                placeholder="10.00"
                value={form.amount}
                aria-invalid={fieldError === 'amount' || undefined}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
            </FormField>
          </div>
          {allowEarnings ? (
            <FormField label={t('account')} htmlFor={`${id}-account`}>
              <Select
                id={`${id}-account`}
                value={form.account}
                onChange={(e) => setForm({ ...form, account: e.target.value as WalletAdjustForm['account'] })}
              >
                <option value="WALLET">{t('accountWallet')}</option>
                <option value="EARNINGS">{t('accountEarnings')}</option>
              </Select>
            </FormField>
          ) : null}
          <FormField label={t('reason')} htmlFor={`${id}-reason`} error={fieldError === 'reason' ? t('reasonError') : undefined}>
            <Textarea
              id={`${id}-reason`}
              value={form.reason}
              maxLength={300}
              aria-invalid={fieldError === 'reason' || undefined}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
            />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => change(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" loading={busy}>
              {t('submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
