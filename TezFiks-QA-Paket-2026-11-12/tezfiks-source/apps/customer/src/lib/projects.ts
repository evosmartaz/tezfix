import { bakuDayKey, type Category, type ProjectDetail, type ProjectStatus, type QuoteView } from '@tezfiks/shared';
import { addressInputFromDraft, validateAddressDraft, type AddressDraft } from './address';

/** "Biznes sifarişi" form (board 02 D). Dates are Baku calendar days "YYYY-MM-DD". */
export interface ProjectFormValues {
  categoryId: string | null;
  title: string;
  scope: string;
  dateFrom: string | null;
  dateTo: string | null;
  workersNeeded: number;
  description: string;
  photoFileIds: string[];
  address: AddressDraft;
}

export type ProjectFormField = 'category' | 'title' | 'scope' | 'dateFrom' | 'dateTo' | 'workersNeeded' | 'description' | 'photos' | 'address';
export type ProjectFormErrors = Partial<Record<ProjectFormField, string>>;

export const PROJECT_LIMITS = { title: 120, scopeMin: 2, scope: 300, descriptionMin: 3, description: 3000, workersMax: 100, photos: 5 } as const;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Inclusive number of calendar days between two "YYYY-MM-DD" dates (15–19 → 5); 0 when invalid or reversed. */
export function workDays(from: string | null, to: string | null): number {
  if (!from || !to || !DAY_RE.test(from) || !DAY_RE.test(to)) return 0;
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0;
  return Math.round((b - a) / 86_400_000) + 1;
}

/** Quote-only services (flow QUOTE) are ordered through the business form. */
export function isQuoteCategory(c: Pick<Category, 'flow'> | null | undefined): boolean {
  return c?.flow === 'QUOTE';
}

/** i18n keys per field; empty object when the form can be sent. */
export function validateProjectForm(v: ProjectFormValues, ctx: { category: Category | null | undefined; now: Date }): ProjectFormErrors {
  const e: ProjectFormErrors = {};
  if (!v.categoryId || !ctx.category) e.category = 'project.errors.categoryRequired';
  else if (!isQuoteCategory(ctx.category)) e.category = 'project.errors.categoryNotQuote';
  if (v.title.trim().length > PROJECT_LIMITS.title) e.title = 'project.errors.titleTooLong';
  const scope = v.scope.trim();
  if (scope.length < PROJECT_LIMITS.scopeMin) e.scope = 'project.errors.scopeRequired';
  else if (scope.length > PROJECT_LIMITS.scope) e.scope = 'project.errors.scopeTooLong';
  const today = bakuDayKey(ctx.now);
  if (!v.dateFrom) e.dateFrom = 'project.errors.datesRequired';
  else if (v.dateFrom < today) e.dateFrom = 'project.errors.dateInPast';
  if (!v.dateTo) e.dateTo = 'project.errors.datesRequired';
  else if (v.dateFrom && v.dateTo < v.dateFrom) e.dateTo = 'project.errors.dateOrder';
  if (!Number.isInteger(v.workersNeeded) || v.workersNeeded < 1 || v.workersNeeded > PROJECT_LIMITS.workersMax) e.workersNeeded = 'project.errors.workersRange';
  const d = v.description.trim();
  if (d.length < PROJECT_LIMITS.descriptionMin) e.description = 'project.errors.descriptionTooShort';
  else if (d.length > PROJECT_LIMITS.description) e.description = 'project.errors.descriptionTooLong';
  if (v.photoFileIds.length > PROJECT_LIMITS.photos) e.photos = 'project.errors.tooManyPhotos';
  const addr = validateAddressDraft(v.address);
  if (addr) e.address = addr;
  return e;
}

const FIELD_ORDER: ProjectFormField[] = ['category', 'address', 'scope', 'dateFrom', 'dateTo', 'workersNeeded', 'description', 'title', 'photos'];

export function firstProjectError(e: ProjectFormErrors): { field: ProjectFormField; key: string } | null {
  for (const f of FIELD_ORDER) if (e[f]) return { field: f, key: e[f] as string };
  return null;
}

/** POST /projects body (call only after validateProjectForm returned no errors). */
export function buildCreateProjectBody(v: ProjectFormValues) {
  const title = v.title.trim();
  return {
    categoryId: v.categoryId as string,
    ...(title ? { title } : {}),
    scope: v.scope.trim(),
    dateFrom: v.dateFrom as string,
    dateTo: v.dateTo as string,
    workersNeeded: v.workersNeeded,
    description: v.description.trim(),
    photoFileIds: v.photoFileIds,
    address: addressInputFromDraft(v.address),
  };
}

export type QuoteSort = 'price' | 'rating';

/** "Müqayisə və təsdiq": open quotes first, then by total price (or rating), ties by earliest. */
export function sortQuotes(quotes: readonly QuoteView[], by: QuoteSort = 'price'): QuoteView[] {
  const open = (q: QuoteView) => (q.status === 'SUBMITTED' || q.status === 'ACCEPTED' ? 0 : 1);
  return [...quotes].sort((a, b) => {
    const o = open(a) - open(b);
    if (o) return o;
    if (by === 'rating') {
      const r = (b.provider.ratingAvg ?? -1) - (a.provider.ratingAvg ?? -1);
      if (r) return r;
    }
    const p = a.totalAmount - b.totalAmount;
    if (p) return p;
    return Date.parse(a.createdAt) - Date.parse(b.createdAt);
  });
}

/** Cheapest still-open quote (badge "Ən sərfəli"). */
export function cheapestQuoteId(quotes: readonly QuoteView[]): string | null {
  const open = quotes.filter((q) => q.status === 'SUBMITTED');
  if (!open.length) return null;
  return open.reduce((best, q) => (q.totalAmount < best.totalAmount ? q : best)).id;
}

/** Price per worker-day of a quote in qəpik (rounded). */
export function quotePerWorkerDay(q: Pick<QuoteView, 'totalAmount' | 'workers' | 'days'>): number {
  const units = q.workers * q.days;
  return units > 0 ? Math.round(q.totalAmount / units) : q.totalAmount;
}

export function canAcceptQuote(p: Pick<ProjectDetail, 'status'>, q: Pick<QuoteView, 'status'>): boolean {
  return p.status === 'OPEN' && q.status === 'SUBMITTED';
}

const ACTIVE_PROJECT: readonly ProjectStatus[] = ['OPEN', 'AWARDED', 'IN_PROGRESS', 'COMPLETED', 'INVOICED'];

export function isActiveProject(status: ProjectStatus): boolean {
  return ACTIVE_PROJECT.includes(status);
}

export function projectStatusTone(status: ProjectStatus): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  switch (status) {
    case 'OPEN':
      return 'warning';
    case 'AWARDED':
    case 'IN_PROGRESS':
    case 'COMPLETED':
    case 'INVOICED':
      return 'info';
    case 'PAID':
      return 'success';
    case 'EXPIRED':
      return 'danger';
    default:
      return 'neutral';
  }
}

/** Latest progress from the daily reports (0 without reports). */
export function latestProgress(p: Pick<ProjectDetail, 'reports'>): number {
  if (!p.reports.length) return 0;
  const newest = [...p.reports].sort((a, b) => (b.reportDate < a.reportDate ? -1 : b.reportDate > a.reportDate ? 1 : Date.parse(b.createdAt) - Date.parse(a.createdAt)))[0];
  return Math.max(0, Math.min(100, newest.progressPercent));
}

/** "15.10.2026" from "2026-10-15" without timezone shifts. */
export function formatDay(day: string): string {
  if (!DAY_RE.test(day)) return day;
  const [y, m, d] = day.split('-');
  return `${d}.${m}.${y}`;
}

/**
 * The project guarantee can be claimed while `guaranteeUntil` is ahead of the server's "now" (device clock corrected by
 * the server offset, like every other timer). ProjectDetail has no `actions`, so this is the client-side rule.
 */
export function projectGuaranteeOpen(p: { guaranteeUntil: string | null }, clockOffsetMs = 0, now: number = Date.now()): boolean {
  if (!p.guaranteeUntil) return false;
  const until = Date.parse(p.guaranteeUntil);
  return Number.isFinite(until) && until > now + clockOffsetMs;
}
