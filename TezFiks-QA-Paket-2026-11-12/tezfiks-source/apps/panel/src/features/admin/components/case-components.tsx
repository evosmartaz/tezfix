'use client';

import { useId, useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CheckCircle2, RotateCcw, X } from 'lucide-react';
import { DataTable, dataTableColumns, type CursorPage } from '@/components/data-table';
import { DateTime } from '@/components/date-time';
import { FormError, FormField } from '@/components/form-field';
import { StatusBadge } from '@/components/status-badge';
import { toast } from '@/components/toaster';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/input';
import { addCaseNoteAction, listCasesAction, redispatchCaseAction, rejectCaseAction, resolveCaseAction } from '../actions';
import { requestNo, resolveCaseBody, resolveOutcomesFor, type ResolveCaseForm, type ResolveOutcome } from '../mappers';
import type { AdminCaseRow } from '../types';
import { ReasonButton } from './action-buttons';
import { RowLink, Select } from './ui';

type CasesQuery = Parameters<typeof listCasesAction>[0];

/** Müraciətlər list (guarantee claims, price disputes, reports). */
export function CasesTable({ query, initialPage }: { query: CasesQuery; initialPage?: CursorPage<AdminCaseRow> }) {
  const t = useTranslations('panel.admin.cases');
  const tc = useTranslations('common');
  const ta = useTranslations('panel.admin.common');
  const columns = useMemo(() => {
    const col = dataTableColumns<AdminCaseRow>();
    return [
      col.accessor('createdAt', { header: () => t('columns.createdAt'), cell: (info) => <DateTime value={info.getValue()} /> }),
      col.accessor('type', { header: () => t('columns.type'), cell: (info) => tc(`caseType.${info.getValue()}`) }),
      col.display({
        id: 'ref',
        header: () => t('columns.reference'),
        cell: (info) =>
          info.row.original.requestNumber !== null
            ? requestNo(info.row.original.requestNumber)
            : info.row.original.projectNumber !== null
              ? t('projectRef', { number: info.row.original.projectNumber })
              : '—',
      }),
      col.accessor('customerName', { header: () => t('columns.customer') }),
      col.accessor('providerName', { header: () => t('columns.provider'), cell: (info) => info.getValue() ?? '—' }),
      col.accessor('status', { header: () => t('columns.status'), cell: (info) => <StatusBadge family="caseStatus" status={info.getValue()} /> }),
      col.accessor('updatedAt', { header: () => t('columns.updatedAt'), cell: (info) => <DateTime value={info.getValue()} /> }),
      col.display({
        id: 'action',
        header: () => t('columns.action'),
        cell: (info) => <RowLink href={`/admin/cases/${info.row.original.id}`}>{ta('view')}</RowLink>,
      }),
    ];
  }, [t, tc, ta]);
  return (
    <DataTable
      columns={columns}
      queryKey={['admin', 'cases', query]}
      fetchPage={(cursor) => listCasesAction({ ...query, ...(cursor ? { cursor } : {}) })}
      initialPage={initialPage}
      getRowId={(r) => r.id}
      rowHref={(r) => `/admin/cases/${r.id}`}
      emptyTitle={t('empty')}
    />
  );
}

/** Internal note on a case. */
export function CaseNoteForm({ caseId }: { caseId: string }) {
  const t = useTranslations('panel.admin.cases.notes');
  const router = useRouter();
  const id = useId();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    try {
      const r = await addCaseNoteAction(caseId, { body: text });
      if (r.ok) {
        setBody('');
        toast.success(t('added'));
        router.refresh();
      } else setError(r.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <FormError message={error} />
      <label htmlFor={id} className="sr-only">
        {t('placeholder')}
      </label>
      <Textarea id={id} value={body} maxLength={2000} placeholder={t('placeholder')} onChange={(e) => setBody(e.target.value)} />
      <div>
        <Button type="submit" size="sm" variant="secondary" loading={busy} disabled={!body.trim()}>
          {t('add')}
        </Button>
      </div>
    </form>
  );
}

/** Resolve with an outcome (price disputes: complete as cash, re-propose a price, cancel the assignment). */
export function ResolveCaseDialog({ caseId, caseType }: { caseId: string; caseType: string }) {
  const t = useTranslations('panel.admin.cases.resolve');
  const te = useTranslations('panel.admin.enums.resolveOutcome');
  const router = useRouter();
  const id = useId();
  const outcomes = resolveOutcomesFor(caseType);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ResolveCaseForm>({ outcome: outcomes[0], note: '', labor: '', materials: '' });
  const [field, setField] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const built = resolveCaseBody(form);
    if (!built.ok) {
      setField(built.field);
      return;
    }
    setField(null);
    setError(null);
    setBusy(true);
    try {
      const r = await resolveCaseAction(caseId, built.body);
      if (r.ok) {
        toast.success(t('success'));
        setOpen(false);
        router.refresh();
      } else setError(r.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
      <DialogTrigger render={<Button size="sm" />}>
        <CheckCircle2 />
        {t('button')}
      </DialogTrigger>
      <DialogContent closeLabel={t('cancel')}>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('description')}</DialogDescription>
          </DialogHeader>
          <FormError message={error} />
          {outcomes.length > 1 ? (
            <FormField label={t('outcome')} htmlFor={`${id}-outcome`}>
              <Select
                id={`${id}-outcome`}
                value={form.outcome}
                onChange={(e) => setForm({ ...form, outcome: e.target.value as ResolveOutcome })}
              >
                {outcomes.map((o) => (
                  <option key={o} value={o}>
                    {te(o)}
                  </option>
                ))}
              </Select>
            </FormField>
          ) : null}
          {form.outcome === 'REPROPOSE_PRICE' ? (
            <div className="grid grid-cols-2 gap-3">
              <FormField label={t('labor')} htmlFor={`${id}-labor`} error={field === 'labor' ? t('priceError') : undefined}>
                <Input id={`${id}-labor`} inputMode="decimal" value={form.labor} onChange={(e) => setForm({ ...form, labor: e.target.value })} />
              </FormField>
              <FormField label={t('materials')} htmlFor={`${id}-materials`} error={field === 'materials' ? t('priceError') : undefined}>
                <Input
                  id={`${id}-materials`}
                  inputMode="decimal"
                  value={form.materials}
                  onChange={(e) => setForm({ ...form, materials: e.target.value })}
                />
              </FormField>
            </div>
          ) : null}
          <FormField label={t('note')} htmlFor={`${id}-note`} error={field === 'note' ? t('noteError') : undefined}>
            <Textarea id={`${id}-note`} value={form.note} maxLength={2000} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </FormField>
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

/** Case workflow buttons: redispatch (guarantee re-fix), resolve, reject. Hidden once the case is closed. */
export function CaseActions({ caseId, caseType, status }: { caseId: string; caseType: string; status: string }) {
  const t = useTranslations('panel.admin.cases.actions');
  if (status === 'RESOLVED' || status === 'REJECTED') return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {caseType === 'GUARANTEE' && status !== 'REDISPATCHED' ? (
        <ReasonButton
          label={t('redispatch')}
          icon={<RotateCcw />}
          title={t('redispatchTitle')}
          description={t('redispatchDescription')}
          reasonLabel={t('noteOptional')}
          minLength={0}
          maxLength={2000}
          destructive={false}
          successMessage={t('redispatched')}
          action={(note) => redispatchCaseAction(caseId, note ? { note } : {})}
        />
      ) : null}
      <ResolveCaseDialog caseId={caseId} caseType={caseType} />
      <ReasonButton
        label={t('reject')}
        icon={<X />}
        title={t('rejectTitle')}
        description={t('rejectDescription')}
        reasonLabel={t('note')}
        minLength={1}
        maxLength={2000}
        successMessage={t('rejected')}
        action={(note) => rejectCaseAction(caseId, { note })}
      />
    </div>
  );
}
