/**
 * Pure form -> request-body mappers of the company panel (lane P2). Every form keeps strings while editing; these
 * functions validate them with the contract limits and build the exact body the API expects (money in integer qəpik).
 * They return `{ ok: false, field }` instead of throwing so the forms can mark the field.
 */
import {
  toMinor,
  type AssignmentStatus,
  type CompanyRole,
  type CompanyView,
  type FinalPriceEntry,
  type MemberView,
  type PayoutMethodType,
  type ProAssignment,
} from '@tezfiks/shared';

export type Built<B, F extends string> = { ok: true; body: B } | { ok: false; field: F };

/** "12", "12.5", "12,50", "1 200" -> qəpik; null for anything else (including negatives). */
export function parseMoney(text: string | null | undefined): number | null {
  if (text === null || text === undefined) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const minor = toMinor(trimmed);
    return minor >= 0 ? minor : null;
  } catch {
    return null;
  }
}

/**
 * Short fingerprint of a server-rendered first page. Used in a table's query key: after router.refresh() brings new
 * server data, the key changes and the table shows the fresh page instead of its cached copy.
 */
export function pageVersion<T>(page: { items: readonly T[] } | null | undefined, sig: (item: T) => string): string {
  if (!page) return 'none';
  const text = page.items.map(sig).join('|');
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${page.items.length}:${(h >>> 0).toString(36)}`;
}

/** Positive whole number from a text field, or null. */
export function parseCount(text: string | number | null | undefined): number | null {
  if (typeof text === 'number') return Number.isInteger(text) && text >= 0 ? text : null;
  if (!text) return null;
  const t = text.trim();
  if (!/^\d{1,9}$/.test(t)) return null;
  return Number(t);
}

/** "#2851" */
export function requestNo(n: number): string {
  return `#${n}`;
}

/** "Aysel Q." whether the API sends the initial with or without its dot. */
export function customerShortName(c: { firstName: string; lastInitial: string; companyName?: string | null }): string {
  const initial = c.lastInitial.trim().replace(/\.+$/, '');
  const person = [c.firstName.trim(), initial ? `${initial}.` : ''].filter(Boolean).join(' ');
  return c.companyName ? `${c.companyName} (${person})` : person;
}

/** "Rauf Hüseynov" */
export function personName(p: { firstName: string; lastName: string }): string {
  return [p.firstName, p.lastName].filter(Boolean).join(' ').trim();
}

// ----------------------------------------------------------------------------------------------- top-up ---

export const TOPUP_MIN = 100;
export const TOPUP_MAX = 100_000;
/** Quick amounts on the top-up form (qəpik). */
export const TOPUP_PRESETS = [2000, 5000, 10000, 20000] as const;

export interface TopupBody {
  amount: number;
  returnUrl?: string;
}

export function topupBody(amountText: string, returnUrl?: string | null): Built<TopupBody, 'amount'> {
  const amount = parseMoney(amountText);
  if (amount === null || amount < TOPUP_MIN || amount > TOPUP_MAX) return { ok: false, field: 'amount' };
  return { ok: true, body: returnUrl ? { amount, returnUrl } : { amount } };
}

/** Where the test checkout returns to: the company Balans page of the panel (absolute URL). */
export function topupReturnUrl(origin: string | null | undefined, companyId: string): string | undefined {
  if (!origin) return undefined;
  let base: URL;
  try {
    base = new URL(origin);
  } catch {
    return undefined;
  }
  if (base.protocol !== 'http:' && base.protocol !== 'https:') return undefined;
  return `${base.origin}/tezfix/company/${encodeURIComponent(companyId)}/balance?topup=done`;
}

// ----------------------------------------------------------------------------------------------- price ---

export const PRICE_MAX = 100_000_00;

export interface PriceForm {
  labor: string;
  materials: string;
}

/** Manager price entry (B4 keypad): İş haqqı + Material xərci = Yekun məbləğ. An empty materials field counts as 0. */
export function priceBody(form: PriceForm): Built<{ labor: number; materials: number }, 'labor' | 'materials'> {
  const labor = parseMoney(form.labor);
  if (labor === null || labor > PRICE_MAX) return { ok: false, field: 'labor' };
  const materials = form.materials.trim() === '' ? 0 : parseMoney(form.materials);
  if (materials === null || materials > PRICE_MAX) return { ok: false, field: 'materials' };
  if (labor + materials <= 0) return { ok: false, field: 'labor' };
  return { ok: true, body: { labor, materials } };
}

/** Live total under the price form (null while a field is invalid). */
export function priceTotal(form: PriceForm): number | null {
  const labor = form.labor.trim() === '' ? 0 : parseMoney(form.labor);
  const materials = form.materials.trim() === '' ? 0 : parseMoney(form.materials);
  if (labor === null || materials === null) return null;
  return labor + materials;
}

// ------------------------------------------------------------------------------------------ reassign ---

export interface ReassignCandidate {
  handymanId: string;
  userId: string;
  name: string;
  phone: string;
  busy: boolean;
  isOnline: boolean;
  ratingAvg: number | null;
  /** Busy workers are listed but cannot be chosen (the API refuses them). */
  selectable: boolean;
}

/**
 * Workers a job can be moved to: ACTIVE members with a handyman profile and the job's trade, except the current worker.
 * Managers' own worker profiles count too (a manager may also work).
 */
export function reassignCandidates(
  members: readonly MemberView[],
  a: Pick<ProAssignment, 'worker' | 'category'>,
): ReassignCandidate[] {
  return members
    .filter(
      (m) =>
        m.status === 'ACTIVE' &&
        m.handymanId !== null &&
        m.handymanId !== a.worker.handymanId &&
        m.trades.some((t) => t.id === a.category.id),
    )
    .map((m) => ({
      handymanId: m.handymanId as string,
      userId: m.userId,
      name: personName(m),
      phone: m.phone,
      busy: m.busy,
      isOnline: m.isOnline,
      ratingAvg: m.ratingAvg,
      selectable: !m.busy,
    }))
    .sort((x, y) => Number(!x.selectable) - Number(!y.selectable) || Number(!x.isOnline) - Number(!y.isOnline) || x.name.localeCompare(y.name, 'az'));
}

// --------------------------------------------------------------------------------------------- members ---

export const MEMBER_TRADES_MAX = 15;

export function memberTradesBody(tradeIds: readonly string[]): Built<{ tradeIds: string[] }, 'tradeIds'> {
  const unique = [...new Set(tradeIds)];
  if (unique.length < 1 || unique.length > MEMBER_TRADES_MAX) return { ok: false, field: 'tradeIds' };
  return { ok: true, body: { tradeIds: unique } };
}

/** The manager cannot demote or remove themselves from the panel (it would lock them out of this page). */
export function canEditMember(m: Pick<MemberView, 'userId' | 'status'>, myUserId: string): boolean {
  return m.status === 'ACTIVE' && m.userId !== myUserId;
}

// --------------------------------------------------------------------------------------------- invites ---

export interface InviteForm {
  role: CompanyRole;
  maxUses: string;
  expiresInDays: string;
}

export const DEFAULT_INVITE_FORM: InviteForm = { role: 'WORKER', maxUses: '10', expiresInDays: '7' };

export function inviteBody(
  form: InviteForm,
): Built<{ role: CompanyRole; maxUses: number; expiresInDays: number }, 'maxUses' | 'expiresInDays'> {
  const maxUses = parseCount(form.maxUses);
  if (maxUses === null || maxUses < 1 || maxUses > 100) return { ok: false, field: 'maxUses' };
  const expiresInDays = parseCount(form.expiresInDays);
  if (expiresInDays === null || expiresInDays < 1 || expiresInDays > 30) return { ok: false, field: 'expiresInDays' };
  return { ok: true, body: { role: form.role, maxUses, expiresInDays } };
}

/** An invite can still be used (not revoked, not expired, uses left). */
export function inviteActive(
  i: { revokedAt: string | null; expiresAt: string; usedCount: number; maxUses: number },
  nowMs: number,
): boolean {
  return i.revokedAt === null && Date.parse(i.expiresAt) > nowMs && i.usedCount < i.maxUses;
}

// ----------------------------------------------------------------------------------------- payout card ---

export interface PayoutMethodForm {
  type: PayoutMethodType;
  number: string;
  holderName: string;
}

/** Luhn checksum (the API refuses card numbers that fail it). */
export function luhnValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Same rules as the API (payouts/payout-method.ts): card = 16-19 digits passing Luhn; IBAN = AZ + 2 check digits +
 * 4-letter bank code + 20 alphanumerics. Spaces and dashes are allowed while typing.
 */
export function payoutMethodBody(
  form: PayoutMethodForm,
): Built<{ type: PayoutMethodType; number: string; holderName: string }, 'number' | 'holderName'> {
  const compact = form.number.replace(/[\s-]/g, '').toUpperCase();
  const valid =
    form.type === 'CARD' ? /^\d{16,19}$/.test(compact) && luhnValid(compact) : /^AZ\d{2}[A-Z]{4}[A-Z0-9]{20}$/.test(compact);
  if (!valid) return { ok: false, field: 'number' };
  const holderName = form.holderName.trim().replace(/\s+/g, ' ');
  if (holderName.length < 3 || holderName.length > 100) return { ok: false, field: 'holderName' };
  return { ok: true, body: { type: form.type, number: compact, holderName } };
}

// -------------------------------------------------------------------------------------------- settings ---

export interface SettingsForm {
  name: string;
  finalPriceEntry: FinalPriceEntry;
  isVatPayer: boolean;
  tradeIds: string[];
  serviceRadiusKm: string;
  baseLat: string;
  baseLng: string;
  baseAddress: string;
}

export function settingsFormOf(c: CompanyView): SettingsForm {
  return {
    name: c.name,
    finalPriceEntry: c.finalPriceEntry,
    isVatPayer: c.isVatPayer,
    tradeIds: c.trades.map((t) => t.id),
    serviceRadiusKm: String(c.serviceRadiusKm),
    baseLat: c.base ? String(c.base.lat) : '',
    baseLng: c.base ? String(c.base.lng) : '',
    baseAddress: c.baseAddress ?? '',
  };
}

export interface SettingsBody {
  name?: string;
  finalPriceEntry?: FinalPriceEntry;
  isVatPayer?: boolean;
  tradeIds?: string[];
  serviceRadiusKm?: number;
  base?: { lat: number; lng: number };
  baseAddress?: string;
}

function parseCoord(text: string, max: number): number | null {
  const t = text.trim().replace(',', '.');
  if (!/^-?\d{1,3}(\.\d+)?$/.test(t)) return null;
  const v = Number(t);
  return Number.isFinite(v) && Math.abs(v) <= max ? v : null;
}

/** Only the fields that changed (PATCH). An unchanged form gives an empty body. */
export function settingsBody(
  current: CompanyView,
  form: SettingsForm,
): Built<SettingsBody, 'name' | 'tradeIds' | 'serviceRadiusKm' | 'base' | 'baseAddress'> {
  const body: SettingsBody = {};
  const name = form.name.trim();
  if (name.length < 2 || name.length > 120) return { ok: false, field: 'name' };
  if (name !== current.name) body.name = name;
  if (form.finalPriceEntry !== current.finalPriceEntry) body.finalPriceEntry = form.finalPriceEntry;
  if (form.isVatPayer !== current.isVatPayer) body.isVatPayer = form.isVatPayer;
  const trades = [...new Set(form.tradeIds)];
  if (trades.length < 1 || trades.length > 30) return { ok: false, field: 'tradeIds' };
  const before = current.trades.map((t) => t.id).sort();
  if (JSON.stringify([...trades].sort()) !== JSON.stringify(before)) body.tradeIds = trades;
  const radius = parseCount(form.serviceRadiusKm);
  if (radius === null || radius < 2 || radius > 50) return { ok: false, field: 'serviceRadiusKm' };
  if (radius !== current.serviceRadiusKm) body.serviceRadiusKm = radius;
  if (form.baseLat.trim() !== '' || form.baseLng.trim() !== '') {
    const lat = parseCoord(form.baseLat, 90);
    const lng = parseCoord(form.baseLng, 180);
    if (lat === null || lng === null) return { ok: false, field: 'base' };
    if (!current.base || current.base.lat !== lat || current.base.lng !== lng) body.base = { lat, lng };
  }
  const baseAddress = form.baseAddress.trim();
  if (baseAddress.length > 300) return { ok: false, field: 'baseAddress' };
  if (baseAddress !== (current.baseAddress ?? '')) body.baseAddress = baseAddress;
  return { ok: true, body };
}

// --------------------------------------------------------------------------------------------- projects ---

export interface QuoteForm {
  total: string;
  workers: string;
  days: string;
  note: string;
}

/** Platform fee held for a quote: b2bFeePerWorkerDay × workers × days (null while the numbers are invalid). */
export function quoteFeePreview(feePerWorkerDay: number, workersText: string, daysText: string): number | null {
  const workers = parseCount(workersText);
  const days = parseCount(daysText);
  if (workers === null || days === null || workers < 1 || days < 1) return null;
  return feePerWorkerDay * workers * days;
}

/** Inclusive number of days between two ISO dates ("2026-11-01".."2026-11-05" -> 5). */
export function projectDays(dateFrom: string, dateTo: string): number {
  const a = Date.parse(`${dateFrom}T00:00:00Z`);
  const b = Date.parse(`${dateTo}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 1;
  return Math.round((b - a) / 86_400_000) + 1;
}

export function defaultQuoteForm(p: { workersNeeded: number; dateFrom: string; dateTo: string }): QuoteForm {
  return { total: '', workers: String(p.workersNeeded), days: String(projectDays(p.dateFrom, p.dateTo)), note: '' };
}

export interface QuoteBody {
  companyId: string;
  totalAmount: number;
  workers: number;
  days: number;
  note?: string;
}

export function quoteBody(form: QuoteForm, companyId: string): Built<QuoteBody, 'total' | 'workers' | 'days' | 'note'> {
  const totalAmount = parseMoney(form.total);
  if (totalAmount === null || totalAmount < 100 || totalAmount > 1_000_000_00) return { ok: false, field: 'total' };
  const workers = parseCount(form.workers);
  if (workers === null || workers < 1 || workers > 100) return { ok: false, field: 'workers' };
  const days = parseCount(form.days);
  if (days === null || days < 1 || days > 365) return { ok: false, field: 'days' };
  const note = form.note.trim();
  if (note.length > 1000) return { ok: false, field: 'note' };
  return { ok: true, body: { companyId, totalAmount, workers, days, ...(note ? { note } : {}) } };
}

export interface ReportForm {
  note: string;
  progress: string;
  reportDate: string;
}

export function reportBody(
  form: ReportForm,
  companyId: string,
): Built<{ companyId: string; note: string; progressPercent: number; reportDate?: string }, 'note' | 'progress' | 'reportDate'> {
  const note = form.note.trim();
  if (note.length < 1 || note.length > 2000) return { ok: false, field: 'note' };
  const progressPercent = parseCount(form.progress);
  if (progressPercent === null || progressPercent > 100) return { ok: false, field: 'progress' };
  const date = form.reportDate.trim();
  if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)))) {
    return { ok: false, field: 'reportDate' };
  }
  return { ok: true, body: { companyId, note, progressPercent, ...(date ? { reportDate: date } : {}) } };
}

export interface InvoiceLineForm {
  description: string;
  amount: string;
}

/**
 * Invoice lines for "İşi tamamla". No lines (or only blank rows) -> the API's default single line with the awarded
 * quote total. Otherwise every non-blank row needs a description (1-200) and an amount.
 */
export function completeBody(
  lines: readonly InvoiceLineForm[],
  companyId: string,
): Built<{ companyId: string; lines?: Array<{ description: string; amount: number }> }, `lines.${number}`> {
  const filled = lines
    .map((l, i) => ({ ...l, i }))
    .filter((l) => l.description.trim() !== '' || l.amount.trim() !== '');
  if (filled.length === 0) return { ok: true, body: { companyId } };
  if (filled.length > 30) return { ok: false, field: `lines.${filled[30]!.i}` };
  const out: Array<{ description: string; amount: number }> = [];
  for (const l of filled) {
    const description = l.description.trim();
    const amount = parseMoney(l.amount);
    if (description.length < 1 || description.length > 200 || amount === null) return { ok: false, field: `lines.${l.i}` };
    out.push({ description, amount });
  }
  return { ok: true, body: { companyId, lines: out } };
}

export function linesSubtotal(lines: readonly InvoiceLineForm[]): number | null {
  let sum = 0;
  for (const l of lines) {
    if (l.amount.trim() === '') continue;
    const v = parseMoney(l.amount);
    if (v === null) return null;
    sum += v;
  }
  return sum;
}

/** Quote window still open (server deadline vs now). */
export function quoteWindowOpen(p: { status: string; quoteDeadline: string }, nowMs: number): boolean {
  return p.status === 'OPEN' && Date.parse(p.quoteDeadline) > nowMs;
}

// ------------------------------------------------------------------------------------------ assignments ---

/** Whether the manager may enter the final price now (company setting MANAGER, worker arrived). */
export function managerCanEnterPrice(a: Pick<ProAssignment, 'status' | 'actions'>, finalPriceEntry: FinalPriceEntry): boolean {
  return finalPriceEntry === 'MANAGER' && (a.status === 'ARRIVED' || a.actions.enterPrice);
}

const ACTIVE_STATUSES: readonly AssignmentStatus[] = ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'PRICE_PROPOSED', 'PRICE_DISPUTED'];

/** State of the request fee of a job: held while active, then captured, refunded or released (free cancel). */
export function feeState(
  a: Pick<ProAssignment, 'status' | 'fee'>,
): 'held' | 'captured' | 'refunded' | 'released' | null {
  if (!a.fee) return null;
  if (a.fee.refunded) return 'refunded';
  if (a.fee.captured) return 'captured';
  return ACTIVE_STATUSES.includes(a.status) ? 'held' : 'released';
}

export type AssignmentScope = 'active' | 'history';

export function asScope(v: string | string[] | undefined): AssignmentScope {
  return v === 'history' ? 'history' : 'active';
}

/** ETA in whole minutes for the board ("12 dəq"), at least 1 while en route. */
export function etaMinutes(etaSec: number | null | undefined): number | null {
  if (etaSec === null || etaSec === undefined || !Number.isFinite(etaSec)) return null;
  return Math.max(1, Math.round(etaSec / 60));
}
