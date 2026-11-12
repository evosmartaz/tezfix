'use client';

import { useId, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Check, Eraser, Lock, LockOpen, X } from 'lucide-react';
import { api } from '@tezfiks/shared';
import { FormError, FormField } from '@/components/form-field';
import { toast } from '@/components/toaster';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  approveCompanyAction,
  approveHandymanAction,
  blockCompanyAction,
  blockHandymanAction,
  blockUserAction,
  clearStrikesAction,
  rejectCompanyAction,
  rejectHandymanAction,
  unblockCompanyAction,
  unblockHandymanAction,
  unblockUserAction,
} from '../actions';
import { approveBody, type ApproveForm } from '../mappers';
import { ConfirmButton, ReasonButton } from './action-buttons';

/** Approve a pending handyman, optionally recording the fields read from the ID card. */
export function ApproveHandymanDialog({ handymanId }: { handymanId: string }) {
  const t = useTranslations('panel.admin.handymen.approve');
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ApproveForm>({ docNumberLast4: '', birthDate: '', expiry: '' });
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = approveBody(form);
    if (!api.admin.approveHandyman.body.safeParse(body).success) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setError(null);
    setBusy(true);
    try {
      const result = await approveHandymanAction(handymanId, body);
      if (result.ok) {
        toast.success(t('success'));
        setOpen(false);
        router.refresh();
      } else setError(result.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
      <DialogTrigger render={<Button size="sm" />}>
        <Check />
        {t('button')}
      </DialogTrigger>
      <DialogContent closeLabel={t('cancel')}>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('description')}</DialogDescription>
          </DialogHeader>
          <FormError message={error ?? (invalid ? t('invalid') : null)} />
          <FormField label={t('docNumberLast4')} htmlFor={`${id}-doc`} hint={t('docNumberHint')}>
            <Input
              id={`${id}-doc`}
              maxLength={4}
              value={form.docNumberLast4}
              onChange={(e) => setForm({ ...form, docNumberLast4: e.target.value.toUpperCase() })}
            />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label={t('birthDate')} htmlFor={`${id}-birth`}>
              <Input id={`${id}-birth`} type="date" value={form.birthDate} onChange={(e) => setForm({ ...form, birthDate: e.target.value })} />
            </FormField>
            <FormField label={t('expiry')} htmlFor={`${id}-expiry`}>
              <Input id={`${id}-expiry`} type="date" value={form.expiry} onChange={(e) => setForm({ ...form, expiry: e.target.value })} />
            </FormField>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" loading={busy}>
              {t('confirm')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Verification and moderation actions on a handyman (approve / reject / block / unblock / clear strikes). */
export function HandymanActions({
  handymanId,
  status,
  strikes,
}: {
  handymanId: string;
  status: string;
  strikes: number;
}) {
  const t = useTranslations('panel.admin.handymen.actions');
  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === 'PENDING_REVIEW' ? (
        <>
          <ApproveHandymanDialog handymanId={handymanId} />
          <ReasonButton
            label={t('reject')}
            icon={<X />}
            title={t('rejectTitle')}
            description={t('rejectDescription')}
            successMessage={t('rejected')}
            action={(reason) => rejectHandymanAction(handymanId, { reason })}
          />
        </>
      ) : null}
      {status === 'BLOCKED' ? (
        <ConfirmButton
          label={t('unblock')}
          icon={<LockOpen />}
          description={t('unblockDescription')}
          successMessage={t('unblocked')}
          action={() => unblockHandymanAction(handymanId)}
        />
      ) : (
        <ReasonButton
          label={t('block')}
          icon={<Lock />}
          title={t('blockTitle')}
          description={t('blockDescription')}
          successMessage={t('blocked')}
          action={(reason) => blockHandymanAction(handymanId, { reason })}
        />
      )}
      {strikes > 0 ? (
        <ConfirmButton
          label={t('clearStrikes')}
          icon={<Eraser />}
          description={t('clearStrikesDescription', { count: strikes })}
          successMessage={t('strikesCleared')}
          action={() => clearStrikesAction(handymanId)}
        />
      ) : null}
    </div>
  );
}

/** Verification and moderation actions on a company. */
export function CompanyActions({ companyId, status }: { companyId: string; status: string }) {
  const t = useTranslations('panel.admin.companies.actions');
  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === 'PENDING_REVIEW' ? (
        <>
          <ConfirmButton
            label={t('approve')}
            icon={<Check />}
            variant="default"
            description={t('approveDescription')}
            successMessage={t('approved')}
            action={() => approveCompanyAction(companyId)}
          />
          <ReasonButton
            label={t('reject')}
            icon={<X />}
            title={t('rejectTitle')}
            description={t('rejectDescription')}
            successMessage={t('rejected')}
            action={(reason) => rejectCompanyAction(companyId, { reason })}
          />
        </>
      ) : null}
      {status === 'BLOCKED' ? (
        <ConfirmButton
          label={t('unblock')}
          icon={<LockOpen />}
          description={t('unblockDescription')}
          successMessage={t('unblocked')}
          action={() => unblockCompanyAction(companyId)}
        />
      ) : (
        <ReasonButton
          label={t('block')}
          icon={<Lock />}
          title={t('blockTitle')}
          description={t('blockDescription')}
          successMessage={t('blocked')}
          action={(reason) => blockCompanyAction(companyId, { reason })}
        />
      )}
    </div>
  );
}

/** Block / unblock a user account (all sessions are revoked by the API when blocking). */
export function UserBlockActions({ userId, status, revalidate }: { userId: string; status: string; revalidate: string }) {
  const t = useTranslations('panel.admin.customers.actions');
  if (status === 'DELETED') return null;
  return status === 'BLOCKED' ? (
    <ConfirmButton
      label={t('unblock')}
      icon={<LockOpen />}
      description={t('unblockDescription')}
      successMessage={t('unblocked')}
      action={() => unblockUserAction(userId, revalidate)}
    />
  ) : (
    <ReasonButton
      label={t('block')}
      icon={<Lock />}
      title={t('blockTitle')}
      description={t('blockDescription')}
      successMessage={t('blocked')}
      action={(reason) => blockUserAction(userId, { reason }, revalidate)}
    />
  );
}
