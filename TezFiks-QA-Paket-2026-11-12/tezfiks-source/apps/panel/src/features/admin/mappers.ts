/**
 * Pure data mappers of the admin panel: URL search params -> contract queries, API responses -> view models,
 * form values -> contract request bodies. No React, no server APIs (unit tested in test/admin-mappers.test.ts).
 */
import type { z } from 'zod';
import {
  api,
  asLocale,
  DEFAULT_SETTINGS,
  PlatformSettingsSchema,
  toMinor,
  type Category,
  type PlatformSettings,
} from '@tezfiks/shared';

// ------------------------------------------------------------------------- search params ---

export type SearchParams = Record<string, string | string[] | undefined>;

export function firstParam(sp: SearchParams | undefined, key: string): string | undefined {
  const v = sp?.[key];
  const s = Array.isArray(v) ? v[0] : v;
  const trimmed = s?.trim();
  return trimmed ? trimmed : undefined;
}

type ShapeOf<S> = S extends z.ZodObject<infer Shape> ? Shape : never;

/** Keeps only the given keys whose URL value passes the contract field schema (invalid values are dropped). */
export function queryFromSearch<S extends z.ZodObject, K extends keyof ShapeOf<S> & string>(
  schema: S,
  sp: SearchParams | undefined,
  keys: readonly K[],
): { [P in K]?: z.output<ShapeOf<S>[P]> } {
  const out: Record<string, unknown> = {};
  const shape = schema.shape as Record<string, z.ZodType>;
  for (const key of keys) {
    const raw = firstParam(sp, key);
    if (raw === undefined) continue;
    const parsed = shape[key].safeParse(raw);
    if (parsed.success && parsed.data !== undefined) out[key] = parsed.data;
  }
  return out as { [P in K]?: z.output<ShapeOf<S>[P]> };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Baku day (YYYY-MM-DD from a date input) -> ISO bounds with the +04:00 offset; null when invalid. */
export function bakuDayBounds(date: string | undefined): { from: string; to: string } | null {
  if (!date || !DATE_RE.test(date)) return null;
  const from = `${date}T00:00:00.000+04:00`;
  if (!Number.isFinite(Date.parse(from))) return null;
  const [y, m, d] = date.split('-').map(Number);
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  return { from, to: `${date}T23:59:59.999+04:00` };
}

/** Sifarişlər filters: status, q (number / names) and a Baku date range from `from` / `to` date inputs. */
export function requestsQuery(sp: SearchParams | undefined) {
  const base = queryFromSearch(api.admin.requests.query, sp, ['status', 'q']);
  const from = bakuDayBounds(firstParam(sp, 'from'))?.from;
  const to = bakuDayBounds(firstParam(sp, 'to'))?.to;
  return { ...base, ...(from ? { from } : {}), ...(to ? { to } : {}) };
}

export const handymenQuery = (sp: SearchParams | undefined) =>
  queryFromSearch(api.admin.handymen.query, sp, ['tab', 'q']);
export const companiesQuery = (sp: SearchParams | undefined) =>
  queryFromSearch(api.admin.companies.query, sp, ['tab', 'q']);
export const customersQuery = (sp: SearchParams | undefined) =>
  queryFromSearch(api.admin.customers.query, sp, ['type', 'q']);
export const ledgerQuery = (sp: SearchParams | undefined) =>
  queryFromSearch(api.admin.ledger.query, sp, ['kind', 'ownerType', 'ownerId']);
export const paymentsQuery = (sp: SearchParams | undefined) =>
  queryFromSearch(api.admin.payments.query, sp, ['status', 'purpose']);
export const payoutsQuery = (sp: SearchParams | undefined) => queryFromSearch(api.admin.payouts.query, sp, ['status']);
export const casesQuery = (sp: SearchParams | undefined) =>
  queryFromSearch(api.admin.cases.query, sp, ['status', 'type']);
export const projectsQuery = (sp: SearchParams | undefined) =>
  queryFromSearch(api.admin.projects.query, sp, ['status']);
export const auditQuery = (sp: SearchParams | undefined) =>
  queryFromSearch(api.admin.audit.query, sp, ['entityType', 'entityId']);

export const PAYMENT_TABS = ['ledger', 'payments', 'payouts', 'invoices'] as const;
export type PaymentTab = (typeof PAYMENT_TABS)[number];

export function paymentsTab(sp: SearchParams | undefined): PaymentTab {
  const tab = firstParam(sp, 'tab');
  return (PAYMENT_TABS as readonly string[]).includes(tab ?? '') ? (tab as PaymentTab) : 'ledger';
}

/** `path?…` with `patch` applied to the current params (undefined / '' removes a key; the cursor is never kept). */
export function hrefWith(
  path: string,
  current: Record<string, string | undefined>,
  patch: Record<string, string | undefined>,
): string {
  const merged: Record<string, string | undefined> = { ...current, ...patch };
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) {
    if (k === 'cursor' || v === undefined || v === '') continue;
    qs.set(k, v);
  }
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

/** Flat string params of a page (for hrefWith / filter bars). */
export function flatParams(sp: SearchParams | undefined): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const key of Object.keys(sp ?? {})) out[key] = firstParam(sp, key);
  return out;
}

// ----------------------------------------------------------------------------- dashboard ---

function localizedNumber(text: string, locale: string): string {
  return asLocale(locale) === 'en' ? text : text.replace('.', ',');
}

/** Decimal number with the locale separator ("1,5" in az/ru, "1.5" in en). */
export function decimalText(value: number, locale: string, digits = 1): string {
  return localizedNumber(value.toFixed(digits), locale);
}

/** Signed percentage from a value already in percent ("+12%", "-1,1%"); null -> "—". */
export function signedPercent(value: number | null | undefined, locale: string, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const rounded = Number(value.toFixed(digits));
  const text = Number.isInteger(rounded) ? String(Math.abs(rounded)) : Math.abs(rounded).toFixed(digits);
  const sign = rounded > 0 ? '+' : rounded < 0 ? '-' : '';
  return `${sign}${localizedNumber(text, locale)}%`;
}

/** Platform fee per order for the "N sifariş × 10 ₼" hint: the configured request fee, else the average. */
export function feePerOrder(revenue: number, orders: number, requestFee?: number | null): number {
  if (typeof requestFee === 'number' && requestFee > 0) return requestFee;
  return orders > 0 ? Math.round(revenue / orders) : 0;
}

/** "2026-09-01" -> "01 Sentyabr 2026" with the month name from i18n. */
export function longDate(isoDate: string, monthName: (month: number) => string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!m) return isoDate;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return isoDate;
  return `${m[3]} ${monthName(month)} ${m[1]}`;
}

export interface DashboardKpis {
  ordersToday: number;
  ordersDelta: string;
  ordersDeltaTone: 'up' | 'down' | 'flat';
  activeHandymen: number;
  onlineHandymen: number;
  feeRevenueToday: number;
  feeOrdersToday: number;
  feePerOrder: number;
  cancelRate: string;
  cancelRateDelta: string;
}

/**
 * Board 05 KPI tiles. `ordersDeltaPct` is in percent (12 = +12%); `cancelRate` and `cancelRateDelta` are ratios
 * (0.063 = 6.3%, -0.011 = -1.1 percentage points over the week).
 */
export function dashboardKpis(
  d: {
    ordersToday: number;
    ordersDeltaPct: number | null;
    activeHandymen: number;
    onlineHandymen: number;
    feeRevenueToday: number;
    feeOrdersToday: number;
    cancelRate: number;
    cancelRateDelta: number | null;
  },
  locale: string,
  requestFee?: number | null,
): DashboardKpis {
  const delta = d.ordersDeltaPct;
  return {
    ordersToday: d.ordersToday,
    ordersDelta: signedPercent(delta, locale, 0),
    ordersDeltaTone: delta === null || delta === 0 ? 'flat' : delta > 0 ? 'up' : 'down',
    activeHandymen: d.activeHandymen,
    onlineHandymen: d.onlineHandymen,
    feeRevenueToday: d.feeRevenueToday,
    feeOrdersToday: d.feeOrdersToday,
    feePerOrder: feePerOrder(d.feeRevenueToday, d.feeOrdersToday, requestFee),
    cancelRate: signedPercent(d.cancelRate * 100, locale).replace(/^\+/, ''),
    cancelRateDelta: signedPercent(d.cancelRateDelta === null ? null : d.cancelRateDelta * 100, locale),
  };
}

/**
 * Status shown in order lists (board 05): while a request is assigned / in progress the primary assignment's status
 * is more telling ("Usta yolda", "İcradadır"); otherwise the request status.
 */
export function orderDisplayStatus(row: {
  status: string;
  assignmentStatus: string | null;
}): { family: 'requestStatus' | 'assignmentStatus'; status: string } {
  if ((row.status === 'ASSIGNED' || row.status === 'IN_PROGRESS') && row.assignmentStatus) {
    return { family: 'assignmentStatus', status: row.assignmentStatus };
  }
  return { family: 'requestStatus', status: row.status };
}

/** "#2847" */
export function requestNo(n: number | null | undefined): string {
  return n === null || n === undefined ? '—' : `#${n}`;
}

/** Short customer/provider name as on board 05 ("Nizami T."). Names are already short in admin rows. */
export function personName(first: string, last?: string | null): string {
  return [first, last].filter(Boolean).join(' ').trim();
}

// -------------------------------------------------------------------- request timeline ---

export interface TimelineItem {
  at: string;
  event: string;
  actor: string | null;
  details: string | null;
}

/** Oldest first; stable for equal timestamps. */
export function sortTimeline<T extends { at: string }>(items: readonly T[]): T[] {
  return items
    .map((item, i) => ({ item, i, t: Date.parse(item.at) }))
    .sort((a, b) => (a.t - b.t) || a.i - b.i)
    .map((x) => x.item);
}

/** Translation key for a timeline event name (e.g. "offers.sent" -> "offers_sent"); the page falls back to the raw text. */
export function timelineKey(event: string): string {
  return event.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

// ----------------------------------------------------------------------------------- KYC ---

export interface KycFiles {
  idFront: KycFile;
  idBack: KycFile;
  selfieFront: KycFile;
  selfieTurn: KycFile;
  selfieBlink: KycFile;
  tradeProofs: KycFile[];
  companyDocs: KycFile[];
}
export interface KycFile {
  id: string;
  url: string;
  contentType: string;
  kind: string;
}

export type KycImageKey =
  | 'idFront'
  | 'idBack'
  | 'selfieFront'
  | 'selfieTurn'
  | 'selfieBlink'
  | 'tradeProof'
  | 'companyDoc';

export interface KycImage {
  key: KycImageKey;
  /** 1-based index for repeated documents. */
  index: number;
  file: KycFile;
  isPdf: boolean;
}

/**
 * Documents in review order: ID front/back side by side, then the three guided selfies, then trade proofs and company
 * documents. URLs are the short-lived signed admin URLs from the API, used as they are.
 */
export function kycImages(files: KycFiles): { id: KycImage[]; selfies: KycImage[]; other: KycImage[] } {
  const img = (key: KycImageKey, file: KycFile, index = 1): KycImage => ({
    key,
    index,
    file,
    isPdf: file.contentType === 'application/pdf',
  });
  return {
    id: [img('idFront', files.idFront), img('idBack', files.idBack)],
    selfies: [img('selfieFront', files.selfieFront), img('selfieTurn', files.selfieTurn), img('selfieBlink', files.selfieBlink)],
    other: [
      ...files.tradeProofs.map((f, i) => img('tradeProof', f, i + 1)),
      ...files.companyDocs.map((f, i) => img('companyDoc', f, i + 1)),
    ],
  };
}

export interface ApproveForm {
  docNumberLast4: string;
  birthDate: string;
  expiry: string;
}

/** Approve body: extracted fields only when given; the document number is upper-cased. */
export function approveBody(form: ApproveForm): { extracted?: { docNumberLast4?: string; birthDate?: string; expiry?: string } } {
  const extracted: { docNumberLast4?: string; birthDate?: string; expiry?: string } = {};
  const doc = form.docNumberLast4.trim().toUpperCase();
  if (doc) extracted.docNumberLast4 = doc;
  if (form.birthDate.trim()) extracted.birthDate = form.birthDate.trim();
  if (form.expiry.trim()) extracted.expiry = form.expiry.trim();
  return Object.keys(extracted).length ? { extracted } : {};
}

// --------------------------------------------------------------------------------- money ---

/** "12,50" / "12.5" / "12" AZN -> qəpik; null when empty or invalid. */
export function parseMoneyInput(text: string | number | null | undefined): number | null {
  if (text === null || text === undefined) return null;
  const s = String(text).trim();
  if (!s) return null;
  try {
    return toMinor(s);
  } catch {
    return null;
  }
}

/** qəpik -> "12.50" for an input field (always dot, no grouping). */
export function moneyInput(minor: number): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(minor));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export type WalletOwnerType = 'CUSTOMER_ACCOUNT' | 'HANDYMAN' | 'COMPANY';

export interface WalletAdjustForm {
  direction: 'credit' | 'debit';
  amount: string;
  account: 'WALLET' | 'EARNINGS';
  reason: string;
}

export type WalletAdjustError = 'amount' | 'reason';

/** Wallet adjustment body with a signed qəpik amount (credit = add balance). */
export function walletAdjustBody(
  form: WalletAdjustForm,
  owner: { type: WalletOwnerType; id: string },
):
  | { ok: true; body: { owner: { type: WalletOwnerType; id: string }; account: 'WALLET' | 'EARNINGS'; amount: number; reason: string } }
  | { ok: false; field: WalletAdjustError } {
  const minor = parseMoneyInput(form.amount);
  if (minor === null || minor <= 0 || minor > 10_000_000) return { ok: false, field: 'amount' };
  const reason = form.reason.trim();
  if (reason.length < 3 || reason.length > 300) return { ok: false, field: 'reason' };
  const account = owner.type === 'CUSTOMER_ACCOUNT' ? 'WALLET' : form.account;
  return {
    ok: true,
    body: { owner, account, amount: form.direction === 'debit' ? -minor : minor, reason },
  };
}

// --------------------------------------------------------------------------------- cases ---

export const RESOLVE_OUTCOMES = ['RESOLVED', 'COMPLETE_CASH', 'REPROPOSE_PRICE', 'CANCEL_ASSIGNMENT'] as const;
export type ResolveOutcome = (typeof RESOLVE_OUTCOMES)[number];

export interface ResolveCaseForm {
  outcome: ResolveOutcome;
  note: string;
  labor: string;
  materials: string;
}

/** Outcomes offered for a case type: price disputes get the price outcomes, other cases only RESOLVED. */
export function resolveOutcomesFor(caseType: string): ResolveOutcome[] {
  return caseType === 'PRICE_DISPUTE' ? [...RESOLVE_OUTCOMES] : ['RESOLVED'];
}

export function resolveCaseBody(
  form: ResolveCaseForm,
):
  | { ok: true; body: { note: string; outcome: ResolveOutcome; price?: { labor: number; materials: number } } }
  | { ok: false; field: 'note' | 'labor' | 'materials' } {
  const note = form.note.trim();
  if (!note || note.length > 2000) return { ok: false, field: 'note' };
  if (form.outcome !== 'REPROPOSE_PRICE') return { ok: true, body: { note, outcome: form.outcome } };
  const labor = parseMoneyInput(form.labor);
  if (labor === null || labor < 0) return { ok: false, field: 'labor' };
  const materials = form.materials.trim() ? parseMoneyInput(form.materials) : 0;
  if (materials === null || materials < 0) return { ok: false, field: 'materials' };
  if (labor + materials <= 0) return { ok: false, field: 'labor' };
  return { ok: true, body: { note, outcome: 'REPROPOSE_PRICE', price: { labor, materials } } };
}

// ------------------------------------------------------------------------------ settings ---

export type SettingKey = keyof PlatformSettings;
export type SettingKind = 'money' | 'int' | 'decimal';
export type SettingUnit = 'azn' | 'sec' | 'min' | 'hours' | 'days' | 'percent' | 'count' | 'm';

export interface SettingField {
  key: SettingKey;
  kind: SettingKind;
  unit: SettingUnit;
}

/** Settings form layout (spec section 4): fees, dispatch timers, scheduling, jobs, limits. */
export const SETTINGS_GROUPS: ReadonlyArray<{ id: string; fields: readonly SettingField[] }> = [
  {
    id: 'fees',
    fields: [
      { key: 'requestFee', kind: 'money', unit: 'azn' },
      { key: 'emergencyFeePerSlot', kind: 'money', unit: 'azn' },
      { key: 'cancelPenalty', kind: 'money', unit: 'azn' },
      { key: 'penaltyCompensation', kind: 'money', unit: 'azn' },
      { key: 'b2bFeePerWorkerDay', kind: 'money', unit: 'azn' },
      { key: 'lowBalanceThreshold', kind: 'money', unit: 'azn' },
      { key: 'vatRatePercent', kind: 'decimal', unit: 'percent' },
    ],
  },
  {
    id: 'dispatch',
    fields: [
      { key: 'offerTtlSec', kind: 'int', unit: 'sec' },
      { key: 'ringStepSec', kind: 'int', unit: 'sec' },
      { key: 'emergencyRingStepSec', kind: 'int', unit: 'sec' },
      { key: 'noMatchAfterSec', kind: 'int', unit: 'sec' },
      { key: 'minCandidates', kind: 'int', unit: 'count' },
      { key: 'maxOffersPerStep', kind: 'int', unit: 'count' },
      { key: 'onlineStaleSec', kind: 'int', unit: 'sec' },
    ],
  },
  {
    id: 'cancellation',
    fields: [
      { key: 'freeCancelSec', kind: 'int', unit: 'sec' },
      { key: 'contactUnlockEtaSec', kind: 'int', unit: 'sec' },
      { key: 'arrivalMaxDistanceM', kind: 'int', unit: 'm' },
      { key: 'noShowAfterMin', kind: 'int', unit: 'min' },
      { key: 'autoCompleteAfterMin', kind: 'int', unit: 'min' },
      { key: 'chatOpenAfterTerminalMin', kind: 'int', unit: 'min' },
    ],
  },
  {
    id: 'scheduling',
    fields: [
      { key: 'scheduledMinLeadMin', kind: 'int', unit: 'min' },
      { key: 'scheduledMaxLeadDays', kind: 'int', unit: 'days' },
      { key: 'scheduledLiveDispatchLeadMin', kind: 'int', unit: 'min' },
      { key: 'scheduledUnfilledLeadMin', kind: 'int', unit: 'min' },
      { key: 'scheduledOfferWindowMin', kind: 'int', unit: 'min' },
    ],
  },
  {
    id: 'guarantee',
    fields: [
      { key: 'guaranteeDays', kind: 'int', unit: 'days' },
      { key: 'guaranteeOriginalProviderMin', kind: 'int', unit: 'min' },
      { key: 'quoteWindowHours', kind: 'decimal', unit: 'hours' },
    ],
  },
  {
    id: 'limits',
    fields: [
      { key: 'maxSlots', kind: 'int', unit: 'count' },
      { key: 'maxPhotos', kind: 'int', unit: 'count' },
    ],
  },
];

export const SETTING_FIELDS: readonly SettingField[] = SETTINGS_GROUPS.flatMap((g) => g.fields);

export type SettingsForm = Record<SettingKey, string>;

function settingText(field: SettingField, value: number): string {
  return field.kind === 'money' ? moneyInput(value) : String(value);
}

/** Settings -> form strings (money in AZN). */
export function settingsToForm(settings: PlatformSettings): SettingsForm {
  const out = {} as SettingsForm;
  for (const f of SETTING_FIELDS) out[f.key] = settingText(f, settings[f.key]);
  return out;
}

/** Display text of a default value next to the field ("10.00", "30"). */
export function settingDefaultText(field: SettingField, defaults: PlatformSettings = DEFAULT_SETTINGS): string {
  return settingText(field, defaults[field.key]);
}

function parseSetting(field: SettingField, text: string): number | null {
  const s = text.trim().replace(',', '.');
  if (!s) return null;
  if (field.kind === 'money') return parseMoneyInput(s);
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  if (field.kind === 'int' && !Number.isInteger(n)) return null;
  return n;
}

/**
 * Only the changed settings, validated with the contract schema (PlatformSettingsSchema.partial()).
 * `errors` lists the invalid fields (unparseable or out of range).
 */
export function settingsPatch(
  form: SettingsForm,
  current: PlatformSettings,
): { ok: true; patch: Partial<PlatformSettings> } | { ok: false; errors: SettingKey[] } {
  const patch: Partial<Record<SettingKey, number>> = {};
  const errors: SettingKey[] = [];
  for (const f of SETTING_FIELDS) {
    const value = parseSetting(f, form[f.key] ?? '');
    if (value === null) {
      errors.push(f.key);
      continue;
    }
    if (value !== current[f.key]) patch[f.key] = value;
  }
  if (errors.length === 0) {
    const parsed = PlatformSettingsSchema.partial().safeParse(patch);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (typeof key === 'string' && !errors.includes(key as SettingKey)) errors.push(key as SettingKey);
      }
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, patch: patch as Partial<PlatformSettings> };
}

// ---------------------------------------------------------------------------- categories ---

export interface CategoryNode {
  category: Category;
  children: CategoryNode[];
}

/** Tree from the flat admin list (parentId), sorted by sortOrder then name. Orphans become roots. */
export function buildCategoryTree(items: readonly Category[]): CategoryNode[] {
  const nodes = new Map<string, CategoryNode>();
  for (const c of items) nodes.set(c.id, { category: c, children: [] });
  const roots: CategoryNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.category.parentId ? nodes.get(node.category.parentId) : undefined;
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }
  const sort = (list: CategoryNode[]) => {
    list.sort(
      (a, b) =>
        a.category.sortOrder - b.category.sortOrder || a.category.name.localeCompare(b.category.name),
    );
    for (const n of list) sort(n.children);
  };
  sort(roots);
  return roots;
}

export interface CategoryForm {
  slug: string;
  parentId: string;
  vertical: 'HOME' | 'AUTO';
  kind: 'GROUP' | 'SERVICE';
  nameAz: string;
  nameRu: string;
  nameEn: string;
  icon: string;
  featured: boolean;
  flow: 'INSTANT' | 'QUOTE';
  emergencyAllowed: boolean;
  sortOrder: string;
  active: boolean;
  keywords: string;
}

export function categoryToForm(c?: Category | null): CategoryForm {
  return {
    slug: c?.slug ?? '',
    parentId: c?.parentId ?? '',
    vertical: c?.vertical ?? 'HOME',
    kind: c?.kind ?? 'SERVICE',
    nameAz: c?.names.az ?? '',
    nameRu: c?.names.ru ?? '',
    nameEn: c?.names.en ?? '',
    icon: c?.icon ?? '',
    featured: c?.featured ?? false,
    flow: c?.flow ?? 'INSTANT',
    emergencyAllowed: c?.emergencyAllowed ?? false,
    sortOrder: String(c?.sortOrder ?? 0),
    active: c?.active ?? true,
    keywords: (c?.keywords ?? []).join(', '),
  };
}

/** Category body for create/update (keywords from a comma/newline separated list, de-duplicated). */
export function categoryBody(form: CategoryForm) {
  const keywords = [
    ...new Set(
      form.keywords
        .split(/[,\n]/)
        .map((k) => k.trim())
        .filter(Boolean),
    ),
  ];
  const sortOrder = Number.parseInt(form.sortOrder, 10);
  return {
    slug: form.slug.trim().toLowerCase(),
    parentId: form.parentId ? form.parentId : null,
    vertical: form.vertical,
    kind: form.kind,
    names: { az: form.nameAz.trim(), ru: form.nameRu.trim(), en: form.nameEn.trim() },
    icon: form.icon.trim() ? form.icon.trim() : null,
    featured: form.featured,
    flow: form.flow,
    emergencyAllowed: form.emergencyAllowed,
    sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0,
    active: form.active,
    keywords,
  };
}

/** Groups that can be a parent (same vertical, not the category itself). */
export function parentOptions(items: readonly Category[], vertical: string, selfId?: string): Category[] {
  return items
    .filter((c) => c.kind === 'GROUP' && c.vertical === vertical && c.id !== selfId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

/** Active instant SERVICE categories (demo test requests). */
export function instantServices(items: readonly Category[]): Category[] {
  return items
    .filter((c) => c.kind === 'SERVICE' && c.active && c.flow === 'INSTANT')
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ------------------------------------------------------------------------------ live map ---

export type HandymanMapState = 'bot' | 'busy' | 'online' | 'offline';

export const MAP_COLORS: Record<HandymanMapState | 'request' | 'searching', string> = {
  online: '#2F5BFF',
  busy: '#F59E0B',
  bot: '#7C3AED',
  offline: '#94A3B8',
  request: '#C83746',
  searching: '#F59E0B',
};

export function handymanMapState(h: { isOnline: boolean; busy: boolean; isBot: boolean }): HandymanMapState {
  if (h.busy) return 'busy';
  if (!h.isOnline) return 'offline';
  if (h.isBot) return 'bot';
  return 'online';
}

export interface LiveMapData {
  handymen: Array<{
    id: string;
    name: string;
    lat: number;
    lng: number;
    isOnline: boolean;
    busy: boolean;
    isBot: boolean;
    companyName: string | null;
  }>;
  requests: Array<{
    id: string;
    number: number;
    lat: number;
    lng: number;
    isSearching: boolean;
    categoryName: string;
    cells: string[];
  }>;
}

export interface LiveMapLayers {
  markers: Array<{ id: string; lat: number; lng: number; label: string; color: string }>;
  polygons: Array<{ id: string; points: Array<{ lat: number; lng: number }>; color: string; fillOpacity: number }>;
  counts: Record<HandymanMapState, number> & { requests: number; searching: number };
}

/**
 * Markers (handymen coloured by state, requests in red) and the H3 hexagons of searching requests.
 * `cellBoundary` turns an H3 cell into [lat, lng] pairs (h3-js cellToBoundary); invalid cells are skipped.
 * Marker ids are prefixed ("h:" / "r:") so a click can be routed to the right detail page.
 */
export function liveMapLayers(
  map: LiveMapData,
  cellBoundary: (cell: string) => Array<[number, number]>,
): LiveMapLayers {
  const counts = { bot: 0, busy: 0, online: 0, offline: 0, requests: 0, searching: 0 };
  const markers: LiveMapLayers['markers'] = [];
  for (const h of map.handymen) {
    const state = handymanMapState(h);
    counts[state] += 1;
    markers.push({
      id: `h:${h.id}`,
      lat: h.lat,
      lng: h.lng,
      label: h.companyName ? `${h.name} · ${h.companyName}` : h.name,
      color: MAP_COLORS[state],
    });
  }
  const polygons: LiveMapLayers['polygons'] = [];
  const seen = new Set<string>();
  for (const r of map.requests) {
    counts.requests += 1;
    if (r.isSearching) counts.searching += 1;
    markers.push({ id: `r:${r.id}`, lat: r.lat, lng: r.lng, label: `#${r.number} · ${r.categoryName}`, color: MAP_COLORS.request });
    if (!r.isSearching) continue;
    for (const cell of r.cells) {
      const key = `${r.id}:${cell}`;
      if (seen.has(key)) continue;
      seen.add(key);
      let boundary: Array<[number, number]>;
      try {
        boundary = cellBoundary(cell);
      } catch {
        continue;
      }
      if (boundary.length < 3) continue;
      polygons.push({
        id: key,
        points: boundary.map(([lat, lng]) => ({ lat, lng })),
        color: MAP_COLORS.searching,
        fillOpacity: 0.15,
      });
    }
  }
  return { markers, polygons, counts };
}

/** "h:<id>" -> handyman page, "r:<id>" -> order page. */
export function markerHref(markerId: string): string | null {
  const [kind, id] = markerId.split(':');
  if (!id) return null;
  if (kind === 'h') return `/admin/handymen/${id}`;
  if (kind === 'r') return `/admin/orders/${id}`;
  return null;
}

// ---------------------------------------------------------------------------------- demo ---

export interface DemoRequestForm {
  categoryId: string;
  timing: 'NOW' | 'SCHEDULED' | 'EMERGENCY';
  slots: string;
  /** datetime-local value in Baku time (YYYY-MM-DDTHH:mm), only for SCHEDULED. */
  scheduledAt: string;
  description: string;
}

/** Baku wall time from a datetime-local input -> ISO with +04:00; null when invalid. */
export function bakuLocalToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const iso = `${value}:00.000+04:00`;
  return Number.isFinite(Date.parse(iso)) ? iso : null;
}

export function demoRequestBody(
  form: DemoRequestForm,
  point: { lat: number; lng: number } | null,
):
  | {
      ok: true;
      body: {
        categoryId: string;
        lat: number;
        lng: number;
        timing: 'NOW' | 'SCHEDULED' | 'EMERGENCY';
        slots: number;
        scheduledAt?: string;
        description?: string;
      };
    }
  | { ok: false; field: 'point' | 'categoryId' | 'slots' | 'scheduledAt' } {
  if (!point) return { ok: false, field: 'point' };
  if (!form.categoryId) return { ok: false, field: 'categoryId' };
  const slots = Number.parseInt(form.slots, 10);
  if (!Number.isInteger(slots) || slots < 1 || slots > 10) return { ok: false, field: 'slots' };
  const body: {
    categoryId: string;
    lat: number;
    lng: number;
    timing: 'NOW' | 'SCHEDULED' | 'EMERGENCY';
    slots: number;
    scheduledAt?: string;
    description?: string;
  } = {
    categoryId: form.categoryId,
    lat: Math.round(point.lat * 1e6) / 1e6,
    lng: Math.round(point.lng * 1e6) / 1e6,
    timing: form.timing,
    slots,
  };
  if (form.timing === 'SCHEDULED') {
    const at = bakuLocalToIso(form.scheduledAt);
    if (!at) return { ok: false, field: 'scheduledAt' };
    body.scheduledAt = at;
  }
  if (form.description.trim()) body.description = form.description.trim();
  return { ok: true, body };
}

export interface DemoSpawnForm {
  count: string;
  radius: string;
  /** '' = the simulator picks trades. */
  tradeId: string;
  /** '' = solo bots; otherwise bots join this company as workers (plan B6). */
  companyId: string;
}

export interface DemoSpawnBody {
  count: number;
  radiusKm: number;
  center: { lat: number; lng: number };
  tradeIds?: string[];
  companyId?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Body of api.admin.demoSpawnBots (count 1–50, radius 0.3–20 km); optional keys are left out when not chosen. */
export function demoSpawnBody(
  form: DemoSpawnForm,
  center: { lat: number; lng: number },
): { ok: true; body: DemoSpawnBody } | { ok: false; field: 'count' | 'radius' | 'tradeId' | 'companyId' } {
  const count = Number(form.count.trim());
  if (!form.count.trim() || !Number.isInteger(count) || count < 1 || count > 50) return { ok: false, field: 'count' };
  const radiusKm = Number(form.radius.trim().replace(',', '.'));
  if (!form.radius.trim() || !Number.isFinite(radiusKm) || radiusKm < 0.3 || radiusKm > 20) return { ok: false, field: 'radius' };
  const body: DemoSpawnBody = { count, radiusKm, center };
  if (form.tradeId) {
    if (!UUID_RE.test(form.tradeId)) return { ok: false, field: 'tradeId' };
    body.tradeIds = [form.tradeId];
  }
  if (form.companyId) {
    if (!UUID_RE.test(form.companyId)) return { ok: false, field: 'companyId' };
    body.companyId = form.companyId;
  }
  return { ok: true, body };
}

// --------------------------------------------------------------------------------- admins ---

export interface AdminUserForm {
  name: string;
  role: 'ADMIN' | 'OPERATOR';
  active: boolean;
  password: string;
}

/** Only the changed fields of an admin user (password only when typed). */
export function adminUserPatch(
  form: AdminUserForm,
  current: { name: string; role: string; active: boolean },
): { name?: string; role?: 'ADMIN' | 'OPERATOR'; active?: boolean; password?: string } {
  const patch: { name?: string; role?: 'ADMIN' | 'OPERATOR'; active?: boolean; password?: string } = {};
  if (form.name.trim() && form.name.trim() !== current.name) patch.name = form.name.trim();
  if (form.role !== current.role) patch.role = form.role;
  if (form.active !== current.active) patch.active = form.active;
  if (form.password) patch.password = form.password;
  return patch;
}

// ---------------------------------------------------------------------------------- audit ---

/** Pretty JSON of an audit before/after snapshot, truncated for the table. */
export function jsonPreview(value: unknown, max = 2000): string {
  if (value === null || value === undefined) return '—';
  let text: string;
  try {
    text = JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
