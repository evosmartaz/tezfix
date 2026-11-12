'use client';

import { useId, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { FileCheck2, Plus, Send, Trash2, Undo2 } from 'lucide-react';
import type { InvoiceView, ProviderProjectView } from '@tezfiks/shared';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DateTime } from '@/components/date-time';
import { FormError, FormField } from '@/components/form-field';
import { toast } from '@/components/toaster';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { moneyText } from '@/lib/format';
import { addReportAction, completeProjectAction, submitQuoteAction, withdrawQuoteAction } from '../actions';
import {
  completeBody,
  defaultQuoteForm,
  linesSubtotal,
  quoteBody,
  quoteFeePreview,
  reportBody,
  type InvoiceLineForm,
  type QuoteForm,
  type ReportForm,
} from '../mappers';
import { Note, newKey } from './ui';

// ----------------------------------------------------------------------------------------------- quote ---

/** Quote form with the live platform fee preview (b2bFeePerWorkerDay × workers × days is held on the company wallet). */
export function QuoteFormView({
  companyId,
  project,
  walletAvailable,
}: {
  companyId: string;
  project: ProviderProjectView;
  walletAvailable: number | null;
}) {
  const t = useTranslations('panel.company.projects.quote');
  const locale = useLocale();
  const router = useRouter();
  const id = useId();
  const [form, setForm] = useState<QuoteForm>(() => defaultQuoteForm(project));
  const [field, setField] = useState<'total' | 'workers' | 'days' | 'note' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(() => newKey('quote'));

  const fee = quoteFeePreview(project.feePerWorkerDay, form.workers, form.days);
  const short = fee !== null && walletAvailable !== null && walletAvailable < fee;

  function edit(next: QuoteForm) {
    setForm(next);
    // Different numbers are a different operation: a new idempotency key.
    setKey(newKey('quote'));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const built = quoteBody(form, companyId);
    if (!built.ok) {
      setField(built.field);
      return;
    }
    setField(null);
    setError(null);
    setBusy(true);
    try {
      const r = await submitQuoteAction(companyId, project.id, built.body, key);
      if (r.ok) {
        toast.success(t('submitted'));
        router.refresh();
      } else {
        setError(r.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <FormError message={error} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <FormField label={t('total')} htmlFor={`${id}-total`} error={field === 'total' ? t('totalError') : undefined}>
          <Input
            id={`${id}-total`}
            inputMode="decimal"
            placeholder="5000"
            value={form.total}
            aria-invalid={field === 'total' || undefined}
            onChange={(e) => edit({ ...form, total: e.target.value })}
          />
        </FormField>
        <FormField label={t('workers')} htmlFor={`${id}-workers`} error={field === 'workers' ? t('workersError') : undefined}>
          <Input
            id={`${id}-workers`}
            inputMode="numeric"
            value={form.workers}
            aria-invalid={field === 'workers' || undefined}
            onChange={(e) => edit({ ...form, workers: e.target.value })}
          />
        </FormField>
        <FormField label={t('days')} htmlFor={`${id}-days`} error={field === 'days' ? t('daysError') : undefined}>
          <Input
            id={`${id}-days`}
            inputMode="numeric"
            value={form.days}
            aria-invalid={field === 'days' || undefined}
            onChange={(e) => edit({ ...form, days: e.target.value })}
          />
        </FormField>
      </div>
      <FormField label={t('note')} htmlFor={`${id}-note`} error={field === 'note' ? t('noteError') : undefined}>
        <Textarea id={`${id}-note`} value={form.note} maxLength={1000} onChange={(e) => edit({ ...form, note: e.target.value })} />
      </FormField>
      <div data-testid="quote-fee">
       <Note>
        {fee === null
          ? t('feeUnknown', { fee: moneyText(project.feePerWorkerDay, locale, { compact: true }) })
          : t('fee', {
              amount: moneyText(fee, locale, { compact: true }),
              fee: moneyText(project.feePerWorkerDay, locale, { compact: true }),
              workers: form.workers,
              days: form.days,
            })}
       </Note>
      </div>
      {short ? <Note tone="danger">{t('lowBalance')}</Note> : null}
      <div>
        <Button type="submit" loading={busy}>
          <Send />
          {t('submit')}
        </Button>
      </div>
    </form>
  );
}

export function WithdrawQuoteButton({ companyId, projectId, quoteId }: { companyId: string; projectId: string; quoteId: string }) {
  const t = useTranslations('panel.company.projects.quote');
  const router = useRouter();
  return (
    <ConfirmDialog
      trigger={
        <Button size="sm" variant="outline" className="text-danger">
          <Undo2 />
          {t('withdraw')}
        </Button>
      }
      title={t('withdrawTitle')}
      description={t('withdrawDescription')}
      confirmLabel={t('withdraw')}
      destructive
      onConfirm={async () => {
        const r = await withdrawQuoteAction(companyId, quoteId, projectId);
        if (r.ok) {
          toast.success(t('withdrawn'));
          router.refresh();
          return true;
        }
        toast.error(r.message);
        return false;
      }}
    />
  );
}

// ---------------------------------------------------------------------------------------------- report ---

function todayBaku(): string {
  // Baku is UTC+4 all year.
  return new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 10);
}

export function ReportFormView({ companyId, projectId }: { companyId: string; projectId: string }) {
  const t = useTranslations('panel.company.projects.report');
  const router = useRouter();
  const id = useId();
  const [form, setForm] = useState<ReportForm>(() => ({ note: '', progress: '', reportDate: todayBaku() }));
  const [field, setField] = useState<'note' | 'progress' | 'reportDate' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const built = reportBody(form, companyId);
    if (!built.ok) {
      setField(built.field);
      return;
    }
    setField(null);
    setError(null);
    setBusy(true);
    try {
      const r = await addReportAction(companyId, projectId, built.body);
      if (r.ok) {
        toast.success(t('added'));
        setForm({ note: '', progress: '', reportDate: todayBaku() });
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
      <FormError message={error} />
      <div className="grid grid-cols-2 gap-3">
        <FormField label={t('date')} htmlFor={`${id}-date`} error={field === 'reportDate' ? t('dateError') : undefined}>
          <Input
            id={`${id}-date`}
            type="date"
            value={form.reportDate}
            aria-invalid={field === 'reportDate' || undefined}
            onChange={(e) => setForm({ ...form, reportDate: e.target.value })}
          />
        </FormField>
        <FormField label={t('progress')} htmlFor={`${id}-progress`} error={field === 'progress' ? t('progressError') : undefined}>
          <Input
            id={`${id}-progress`}
            inputMode="numeric"
            placeholder="40"
            value={form.progress}
            aria-invalid={field === 'progress' || undefined}
            onChange={(e) => setForm({ ...form, progress: e.target.value })}
          />
        </FormField>
      </div>
      <FormField label={t('note')} htmlFor={`${id}-note`} error={field === 'note' ? t('noteError') : undefined}>
        <Textarea
          id={`${id}-note`}
          value={form.note}
          maxLength={2000}
          aria-invalid={field === 'note' || undefined}
          onChange={(e) => setForm({ ...form, note: e.target.value })}
        />
      </FormField>
      <p className="text-xs text-muted-foreground">{t('photosHint')}</p>
      <div>
        <Button type="submit" loading={busy}>
          <Plus />
          {t('submit')}
        </Button>
      </div>
    </form>
  );
}

// -------------------------------------------------------------------------------------------- complete ---

/** "İşi tamamla": issues the invoice (hesab-faktura). Lines are optional: by default one line with the quote total. */
export function CompleteProjectForm({
  companyId,
  projectId,
  quoteTotal,
}: {
  companyId: string;
  projectId: string;
  quoteTotal: number | null;
}) {
  const t = useTranslations('panel.company.projects.complete');
  const locale = useLocale();
  const router = useRouter();
  const [lines, setLines] = useState<InvoiceLineForm[]>([]);
  const [badLine, setBadLine] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(() => newKey('complete'));
  const subtotal = linesSubtotal(lines);

  function update(i: number, next: Partial<InvoiceLineForm>) {
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...next } : l)));
    setKey(newKey('complete'));
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        {quoteTotal !== null ? t('defaultLine', { amount: moneyText(quoteTotal, locale) }) : t('hint')}
      </p>
      {lines.map((l, i) => (
        <div key={i} className="grid grid-cols-[1fr_8rem_auto] items-end gap-2" data-line={i}>
          <FormField label={t('lineDescription')} htmlFor={`line-${i}-d`} error={badLine === i ? t('lineError') : undefined}>
            <Input id={`line-${i}-d`} value={l.description} maxLength={200} onChange={(e) => update(i, { description: e.target.value })} />
          </FormField>
          <FormField label={t('lineAmount')} htmlFor={`line-${i}-a`}>
            <Input id={`line-${i}-a`} inputMode="decimal" value={l.amount} onChange={(e) => update(i, { amount: e.target.value })} />
          </FormField>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('removeLine')}
            onClick={() => {
              setLines((prev) => prev.filter((_, j) => j !== i));
              setKey(newKey('complete'));
            }}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={lines.length >= 30}
          onClick={() => {
            setLines((prev) => [...prev, { description: '', amount: '' }]);
            setKey(newKey('complete'));
          }}
        >
          <Plus />
          {t('addLine')}
        </Button>
        {lines.length > 0 ? (
          <span className="text-sm">
            {t('subtotal')}: <strong className="tabular-nums">{moneyText(subtotal, locale)}</strong>
          </span>
        ) : null}
      </div>
      <FormError message={error} />
      <ConfirmDialog
        trigger={
          <Button>
            <FileCheck2 />
            {t('submit')}
          </Button>
        }
        title={t('confirmTitle')}
        description={t('confirmDescription')}
        confirmLabel={t('submit')}
        onConfirm={async () => {
          const built = completeBody(lines, companyId);
          if (!built.ok) {
            setBadLine(Number(built.field.split('.')[1]));
            return false;
          }
          setBadLine(null);
          setError(null);
          const r = await completeProjectAction(companyId, projectId, built.body, key);
          if (r.ok) {
            toast.success(t('done', { number: r.data.number }));
            router.refresh();
            return true;
          }
          setError(r.message);
          return false;
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- invoice ---

export function InvoiceCard({ invoice }: { invoice: InvoiceView }) {
  const t = useTranslations('panel.company.projects.invoice');
  const tc = useTranslations('common');
  const locale = useLocale();
  return (
    <div className="flex flex-col gap-3 text-sm" data-testid="invoice">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-base font-bold">{t('number', { number: invoice.number })}</span>
        <span className="text-xs font-semibold">{tc(`invoiceStatus.${invoice.status}`)}</span>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <div className="text-xs text-muted-foreground">{t('issuer')}</div>
          <div className="font-medium">{invoice.issuer.name}</div>
          {invoice.issuer.voen ? <div className="text-xs">{t('voen', { voen: invoice.issuer.voen })}</div> : null}
        </div>
        <div>
          <div className="text-xs text-muted-foreground">{t('customer')}</div>
          <div className="font-medium">{invoice.customer.name}</div>
          {invoice.customer.voen ? <div className="text-xs">{t('voen', { voen: invoice.customer.voen })}</div> : null}
        </div>
      </div>
      <table className="w-full">
        <tbody>
          {invoice.lines.map((l, i) => (
            <tr key={i} className="border-b border-border">
              <td className="py-1.5">{l.description}</td>
              <td className="py-1.5 text-right tabular-nums">{moneyText(l.amount, locale)}</td>
            </tr>
          ))}
          <tr>
            <td className="pt-2 text-muted-foreground">{t('subtotal')}</td>
            <td className="pt-2 text-right tabular-nums">{moneyText(invoice.subtotal, locale)}</td>
          </tr>
          <tr>
            <td className="text-muted-foreground">
              {invoice.issuer.isVatPayer ? t('vat', { rate: invoice.vatRatePercent }) : t('noVat')}
            </td>
            <td className="text-right tabular-nums">{moneyText(invoice.vatAmount, locale)}</td>
          </tr>
          <tr className="text-base font-bold">
            <td className="pt-1">{t('total')}</td>
            <td className="pt-1 text-right tabular-nums">{moneyText(invoice.total, locale)}</td>
          </tr>
        </tbody>
      </table>
      <div className="text-xs text-muted-foreground">
        {t('issuedAt')}: <DateTime value={invoice.issuedAt} mode="date" />
        {invoice.paidAt ? (
          <>
            {' · '}
            {t('paidAt')}: <DateTime value={invoice.paidAt} mode="date" />
          </>
        ) : null}
      </div>
    </div>
  );
}
