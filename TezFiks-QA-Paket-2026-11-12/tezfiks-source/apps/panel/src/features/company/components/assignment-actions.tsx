'use client';

import { useId, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Ban, Calculator, Repeat } from 'lucide-react';
import type { FinalPriceEntry, ProAssignment } from '@tezfiks/shared';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormError, FormField } from '@/components/form-field';
import { toast } from '@/components/toaster';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input, Label, Textarea } from '@/components/ui/input';
import { moneyText } from '@/lib/format';
import { cn } from '@/lib/utils';
import { cancelAssignmentAction, enterPriceAction, reassignAction } from '../actions';
import { managerCanEnterPrice, priceBody, priceTotal, type PriceForm, type ReassignCandidate } from '../mappers';
import { WorkerPill, newKey } from './ui';

const PROVIDER_CANCEL: readonly string[] = ['ACCEPTED', 'EN_ROUTE'];


/** Price / reassign / cancel actions of a company job (board 04 manager rights). */
export function AssignmentActions({
  companyId,
  assignment: a,
  finalPriceEntry,
  candidates,
}: {
  companyId: string;
  assignment: ProAssignment;
  finalPriceEntry: FinalPriceEntry;
  candidates: ReassignCandidate[] | null;
}) {
  const showPrice = managerCanEnterPrice(a, finalPriceEntry);
  const showReassign = a.status === 'ACCEPTED' && candidates !== null;
  const showCancel = a.actions.cancel || PROVIDER_CANCEL.includes(a.status);
  if (!showPrice && !showReassign && !showCancel) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {showPrice ? <PriceDialog companyId={companyId} assignmentId={a.id} /> : null}
      {showReassign ? <ReassignDialog companyId={companyId} assignmentId={a.id} candidates={candidates ?? []} /> : null}
      {showCancel ? <CancelAssignmentButton companyId={companyId} assignment={a} /> : null}
    </div>
  );
}

const EMPTY_PRICE: PriceForm = { labor: '', materials: '' };

export function PriceDialog({ companyId, assignmentId }: { companyId: string; assignmentId: string }) {
  const t = useTranslations('panel.company.orders.price');
  const tc = useTranslations('common.actions');
  const locale = useLocale();
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<PriceForm>(EMPTY_PRICE);
  const [field, setField] = useState<'labor' | 'materials' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(() => newKey('price'));

  function change(next: boolean) {
    if (busy) return;
    setOpen(next);
    if (next) {
      setForm(EMPTY_PRICE);
      setField(null);
      setError(null);
      setKey(newKey('price'));
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const built = priceBody(form);
    if (!built.ok) {
      setField(built.field);
      return;
    }
    setField(null);
    setError(null);
    setBusy(true);
    try {
      const r = await enterPriceAction(companyId, assignmentId, built.body, key);
      if (r.ok) {
        toast.success(t('success'));
        setOpen(false);
        router.refresh();
      } else {
        setError(r.message);
      }
    } finally {
      setBusy(false);
    }
  }

  const total = priceTotal(form);
  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogTrigger render={<Button size="sm" />}>
        <Calculator />
        {t('button')}
      </DialogTrigger>
      <DialogContent closeLabel={tc('close')}>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('description')}</DialogDescription>
          </DialogHeader>
          <FormError message={error} />
          <div className="grid grid-cols-2 gap-3">
            <FormField label={t('labor')} htmlFor={`${id}-labor`} error={field === 'labor' ? t('laborError') : undefined}>
              <Input
                id={`${id}-labor`}
                inputMode="decimal"
                placeholder="0"
                value={form.labor}
                aria-invalid={field === 'labor' || undefined}
                onChange={(e) => setForm({ ...form, labor: e.target.value })}
              />
            </FormField>
            <FormField
              label={t('materials')}
              htmlFor={`${id}-materials`}
              error={field === 'materials' ? t('materialsError') : undefined}
            >
              <Input
                id={`${id}-materials`}
                inputMode="decimal"
                placeholder="0"
                value={form.materials}
                aria-invalid={field === 'materials' || undefined}
                onChange={(e) => setForm({ ...form, materials: e.target.value })}
              />
            </FormField>
          </div>
          <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2 text-sm">
            <span>{t('total')}</span>
            <span className="text-lg font-bold tabular-nums" data-testid="price-total">
              {moneyText(total, locale)}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{t('warning')}</p>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => change(false)}>
              {tc('cancel')}
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

export function ReassignDialog({
  companyId,
  assignmentId,
  candidates,
}: {
  companyId: string;
  assignmentId: string;
  candidates: ReassignCandidate[];
}) {
  const t = useTranslations('panel.company.orders.reassign');
  const tc = useTranslations('common.actions');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function change(next: boolean) {
    if (busy) return;
    setOpen(next);
    if (next) {
      setPicked(null);
      setError(null);
    }
  }

  async function submit() {
    if (!picked) {
      setError(t('pickError'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await reassignAction(companyId, assignmentId, picked);
      if (r.ok) {
        toast.success(t('success'));
        setOpen(false);
        router.refresh();
      } else {
        setError(r.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        <Repeat />
        {t('button')}
      </DialogTrigger>
      <DialogContent closeLabel={tc('close')}>
        <div className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('description')}</DialogDescription>
          </DialogHeader>
          <FormError message={error} />
          {candidates.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('none')}</p>
          ) : (
            <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto" role="radiogroup" aria-label={t('title')}>
              {candidates.map((c) => (
                <li key={c.handymanId}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={picked === c.handymanId}
                    disabled={!c.selectable || busy}
                    onClick={() => setPicked(c.handymanId)}
                    className={cn(
                      'flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left',
                      picked === c.handymanId ? 'border-primary ring-1 ring-primary' : 'border-border',
                      !c.selectable && 'cursor-not-allowed opacity-60',
                    )}
                  >
                    <span>
                      <span className="block font-semibold">{c.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {c.phone}
                        {c.ratingAvg !== null ? ` • ★ ${c.ratingAvg.toFixed(1)}` : ''}
                      </span>
                    </span>
                    <WorkerPill state={c.busy ? 'busy' : c.isOnline ? 'free' : 'offline'} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => change(false)}>
              {tc('cancel')}
            </Button>
            <Button onClick={submit} loading={busy} disabled={!picked}>
              {t('submit')}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function CancelAssignmentButton({ companyId, assignment: a }: { companyId: string; assignment: ProAssignment }) {
  const t = useTranslations('panel.company.orders.cancel');
  const router = useRouter();
  const id = useId();
  const [reason, setReason] = useState('');
  const [key] = useState(() => newKey('cancel'));
  const free = a.actions.cancelIsFree;
  return (
    <ConfirmDialog
      trigger={
        <Button size="sm" variant="outline" className="text-danger">
          <Ban />
          {t('button')}
        </Button>
      }
      title={t('title')}
      description={free ? t('freeDescription') : t('lateDescription')}
      confirmLabel={t('submit')}
      destructive
      onConfirm={async () => {
        const r = await cancelAssignmentAction(companyId, a.id, reason, key);
        if (r.ok) {
          toast.success(t('success'));
          router.refresh();
          return true;
        }
        toast.error(r.message);
        return false;
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id}>{t('reason')}</Label>
        <Textarea id={id} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
      </div>
    </ConfirmDialog>
  );
}
