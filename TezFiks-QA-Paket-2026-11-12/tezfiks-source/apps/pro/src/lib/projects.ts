import type { ProjectStatus, ProviderProjectView } from '@tezfiks/shared';

/** SubmitQuoteBodySchema limits. */
export const QUOTE_LIMITS = { minTotal: 100, maxTotal: 1_000_000_00, maxWorkers: 100, maxDays: 365, maxNote: 1000 } as const;

/** Platform fee held by a quote (spec 4.10): b2bFeePerWorkerDay × workers × days. */
export function quoteFee(feePerWorkerDay: number, workers: number, days: number): number {
  if (!Number.isInteger(workers) || !Number.isInteger(days) || workers <= 0 || days <= 0) return 0;
  return feePerWorkerDay * workers * days;
}

/** Inclusive day span of the project dates ("2026-11-01".."2026-11-03" → 3). */
export function projectDays(dateFrom: string, dateTo: string): number {
  const a = Date.parse(`${dateFrom}T00:00:00Z`);
  const b = Date.parse(`${dateTo}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 1;
  return Math.round((b - a) / 86_400_000) + 1;
}

export interface QuoteForm {
  /** AZN as typed ("4500", "4500,50"). */
  total: string;
  workers: string;
  days: string;
  note: string;
}

export type QuoteField = 'total' | 'workers' | 'days' | 'note';

function toInt(text: string): number | null {
  const t = (text ?? '').trim();
  return /^\d+$/.test(t) ? Number(t) : null;
}

function toMinorAmount(text: string): number | null {
  const clean = (text ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d{0,2})?$/.test(clean)) return null;
  const [i, f = ''] = clean.split('.');
  return Number(i) * 100 + Number((f + '00').slice(0, 2));
}

/** Validates the quote form (POST /provider/projects/:id/quotes body, without companyId). */
export function validateQuoteForm(form: QuoteForm): {
  errors: Partial<Record<QuoteField, 'required' | 'range'>>;
  body: { totalAmount: number; workers: number; days: number; note?: string } | null;
} {
  const errors: Partial<Record<QuoteField, 'required' | 'range'>> = {};
  const total = toMinorAmount(form.total);
  if (total === null) errors.total = 'required';
  else if (total < QUOTE_LIMITS.minTotal || total > QUOTE_LIMITS.maxTotal) errors.total = 'range';
  const workers = toInt(form.workers);
  if (workers === null) errors.workers = 'required';
  else if (workers < 1 || workers > QUOTE_LIMITS.maxWorkers) errors.workers = 'range';
  const days = toInt(form.days);
  if (days === null) errors.days = 'required';
  else if (days < 1 || days > QUOTE_LIMITS.maxDays) errors.days = 'range';
  const note = (form.note ?? '').trim();
  if (note.length > QUOTE_LIMITS.maxNote) errors.note = 'range';
  if (Object.keys(errors).length) return { errors, body: null };
  return { errors, body: { totalAmount: total!, workers: workers!, days: days!, ...(note ? { note } : {}) } };
}

/** Quote form prefilled from the project (workers needed, inclusive days). */
export function initialQuoteForm(p: Pick<ProviderProjectView, 'workersNeeded' | 'dateFrom' | 'dateTo'>): QuoteForm {
  return { total: '', workers: String(p.workersNeeded), days: String(projectDays(p.dateFrom, p.dateTo)), note: '' };
}

export interface ReportForm {
  note: string;
  progress: number;
  photoIds: string[];
}

/** POST /provider/projects/:id/reports body (daily status report). */
export function validateReportForm(form: ReportForm): { errors: Partial<Record<'note' | 'progress' | 'photos', 'required' | 'range'>>; body: { note: string; progressPercent: number; photoFileIds: string[] } | null } {
  const errors: Partial<Record<'note' | 'progress' | 'photos', 'required' | 'range'>> = {};
  const note = (form.note ?? '').trim();
  if (!note) errors.note = 'required';
  else if (note.length > 2000) errors.note = 'range';
  if (!Number.isInteger(form.progress) || form.progress < 0 || form.progress > 100) errors.progress = 'range';
  if (form.photoIds.length > 5) errors.photos = 'range';
  if (Object.keys(errors).length) return { errors, body: null };
  return { errors, body: { note, progressPercent: form.progress, photoFileIds: form.photoIds } };
}

/** Clamps a progress value to 0..100 in steps of 5 (slider / stepper). */
export function stepProgress(value: number, delta: number): number {
  const next = Math.round((value + delta) / 5) * 5;
  return Math.min(100, Math.max(0, next));
}

export type ProviderProjectPhase = 'open' | 'quoted' | 'awarded' | 'invoiced' | 'closed';

/**
 * What the provider can do with a project:
 * - open: OPEN, no own quote at all and the window is open → quote form (one quote per provider and project: the
 *   server answers CONFLICT ALREADY_QUOTED even after a withdrawal, so a withdrawn quote does not reopen the form);
 * - quoted: own SUBMITTED quote → withdraw;
 * - awarded: own quote won and the work runs (AWARDED / IN_PROGRESS) → daily reports, complete;
 * - invoiced: COMPLETED / INVOICED / PAID with an invoice → invoice view;
 * - closed: anything else (lost, cancelled, expired, window closed).
 */
export function providerPhase(p: Pick<ProviderProjectView, 'status' | 'myQuote' | 'isAwardedToMe' | 'invoice' | 'quoteDeadline'>, serverNowMs: number): ProviderProjectPhase {
  if (p.isAwardedToMe) {
    if (p.status === 'AWARDED' || p.status === 'IN_PROGRESS') return 'awarded';
    if (p.invoice || p.status === 'COMPLETED' || p.status === 'INVOICED' || p.status === 'PAID') return 'invoiced';
    return 'closed';
  }
  if (p.myQuote?.status === 'SUBMITTED' && p.status === 'OPEN') return 'quoted';
  const windowOpen = Date.parse(p.quoteDeadline) > serverNowMs;
  if (p.status === 'OPEN' && windowOpen && !p.myQuote) return 'open';
  return 'closed';
}

export function projectStatusTone(status: ProjectStatus): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  switch (status) {
    case 'OPEN':
      return 'info';
    case 'AWARDED':
    case 'IN_PROGRESS':
      return 'warning';
    case 'COMPLETED':
    case 'INVOICED':
    case 'PAID':
      return 'success';
    default:
      return 'neutral';
  }
}
