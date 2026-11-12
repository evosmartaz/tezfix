import {
  OnboardCompanyBodySchema,
  OnboardSoloBodySchema,
  tzFold,
  type Category,
  type LegalForm,
} from '@tezfiks/shared';
import type { z } from 'zod';

export type OnboardSoloBody = z.output<typeof OnboardSoloBodySchema>;
export type OnboardCompanyBody = z.output<typeof OnboardCompanyBodySchema>;

export interface LatLngValue {
  lat: number;
  lng: number;
}

/** Board 03 A: solo radius slider 2–25 km (default 10). Companies may cover up to 50 km (default 15). */
export const SOLO_RADIUS = { min: 2, max: 25, default: 10 } as const;
export const COMPANY_RADIUS = { min: 2, max: 50, default: 15 } as const;
export const SOLO_MAX_TRADES = 15;
export const COMPANY_MAX_TRADES = 30;
export const LEGAL_FORMS: readonly LegalForm[] = ['MMC', 'ASC', 'QSC', 'FS', 'OTHER'];

export function clampRadius(value: number, range: { min: number; max: number }): number {
  if (!Number.isFinite(value)) return range.min;
  return Math.min(range.max, Math.max(range.min, Math.round(value)));
}

/** VÖEN (tax id) as typed: digits only, at most 10. */
export function sanitizeVoen(text: string): string {
  return (text ?? '').replace(/\D/g, '').slice(0, 10);
}

export function isValidLatLng(p: LatLngValue | null | undefined): p is LatLngValue {
  return !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180 && !(p.lat === 0 && p.lng === 0);
}

export function toggleTrade(selected: readonly string[], id: string, max: number): string[] {
  if (selected.includes(id)) return selected.filter((x) => x !== id);
  if (selected.length >= max) return [...selected];
  return [...selected, id];
}

/** Field → i18n key of the error message. */
export type FormErrors<F extends string> = Partial<Record<F, string>>;

export interface SoloForm {
  firstName: string;
  lastName: string;
  photoFileId: string | null;
  tradeIds: string[];
  radiusKm: number;
  base: LatLngValue | null;
}

export type SoloField = 'firstName' | 'lastName' | 'trades' | 'radius' | 'base';
/** Fields in the order the solo form shows them (the first invalid one is revealed after a failed submit). */
export const SOLO_FIELD_ORDER: readonly SoloField[] = ['firstName', 'lastName', 'trades', 'radius', 'base'];

function nameError(value: string, key: 'firstName' | 'lastName'): string | undefined {
  const v = (value ?? '').trim();
  if (!v) return `onboarding.errors.${key}Required`;
  if (v.length > 60) return 'onboarding.errors.nameTooLong';
  return undefined;
}

/** Validates the "Fərdi usta" form; returns the POST /pro/onboarding/solo body when valid. */
export function validateSoloForm(form: SoloForm): { errors: FormErrors<SoloField>; body: OnboardSoloBody | null } {
  const errors: FormErrors<SoloField> = {};
  const fn = nameError(form.firstName, 'firstName');
  if (fn) errors.firstName = fn;
  const ln = nameError(form.lastName, 'lastName');
  if (ln) errors.lastName = ln;
  if (form.tradeIds.length === 0) errors.trades = 'onboarding.errors.tradesRequired';
  else if (form.tradeIds.length > SOLO_MAX_TRADES) errors.trades = 'onboarding.errors.tradesTooMany';
  if (!Number.isInteger(form.radiusKm) || form.radiusKm < SOLO_RADIUS.min || form.radiusKm > SOLO_RADIUS.max) {
    errors.radius = 'onboarding.errors.radius';
  }
  if (!isValidLatLng(form.base)) errors.base = 'onboarding.errors.baseRequired';
  if (Object.keys(errors).length) return { errors, body: null };
  const parsed = OnboardSoloBodySchema.safeParse({
    firstName: form.firstName.trim(),
    lastName: form.lastName.trim(),
    ...(form.photoFileId ? { photoFileId: form.photoFileId } : {}),
    tradeIds: [...new Set(form.tradeIds)],
    serviceRadiusKm: form.radiusKm,
    base: { lat: form.base!.lat, lng: form.base!.lng },
  });
  if (!parsed.success) return { errors: { trades: 'onboarding.errors.invalid' }, body: null };
  return { errors, body: parsed.data };
}

export interface CompanyForm {
  firstName: string;
  lastName: string;
  name: string;
  legalForm: LegalForm;
  voen: string;
  isVatPayer: boolean;
  tradeIds: string[];
  radiusKm: number;
  base: LatLngValue | null;
  baseAddress: string;
}

export type CompanyField = 'firstName' | 'lastName' | 'name' | 'legalForm' | 'voen' | 'trades' | 'radius' | 'base' | 'baseAddress';
/** Fields in the order the company form shows them. */
export const COMPANY_FIELD_ORDER: readonly CompanyField[] = ['firstName', 'lastName', 'name', 'legalForm', 'voen', 'trades', 'baseAddress', 'base', 'radius'];

/** Validates "Usta şirkəti" registration; returns the POST /pro/onboarding/company body when valid. */
export function validateCompanyForm(form: CompanyForm): { errors: FormErrors<CompanyField>; body: OnboardCompanyBody | null } {
  const errors: FormErrors<CompanyField> = {};
  const fn = nameError(form.firstName, 'firstName');
  if (fn) errors.firstName = fn;
  const ln = nameError(form.lastName, 'lastName');
  if (ln) errors.lastName = ln;
  const name = (form.name ?? '').trim();
  if (name.length < 2) errors.name = 'onboarding.errors.companyNameRequired';
  else if (name.length > 120) errors.name = 'onboarding.errors.companyNameTooLong';
  if (!LEGAL_FORMS.includes(form.legalForm)) errors.legalForm = 'onboarding.errors.legalForm';
  if (!/^\d{10}$/.test(form.voen ?? '')) errors.voen = 'onboarding.errors.voen';
  if (form.tradeIds.length === 0) errors.trades = 'onboarding.errors.tradesRequired';
  else if (form.tradeIds.length > COMPANY_MAX_TRADES) errors.trades = 'onboarding.errors.tradesTooMany';
  if (!Number.isInteger(form.radiusKm) || form.radiusKm < COMPANY_RADIUS.min || form.radiusKm > COMPANY_RADIUS.max) {
    errors.radius = 'onboarding.errors.radius';
  }
  if (!isValidLatLng(form.base)) errors.base = 'onboarding.errors.baseRequired';
  if ((form.baseAddress ?? '').trim().length > 300) errors.baseAddress = 'onboarding.errors.addressTooLong';
  if (Object.keys(errors).length) return { errors, body: null };
  const address = form.baseAddress.trim();
  const parsed = OnboardCompanyBodySchema.safeParse({
    firstName: form.firstName.trim(),
    lastName: form.lastName.trim(),
    company: {
      name,
      legalForm: form.legalForm,
      voen: form.voen,
      isVatPayer: form.isVatPayer,
      tradeIds: [...new Set(form.tradeIds)],
      serviceRadiusKm: form.radiusKm,
      base: { lat: form.base!.lat, lng: form.base!.lng },
      ...(address ? { baseAddress: address } : {}),
    },
  });
  if (!parsed.success) return { errors: { name: 'onboarding.errors.invalid' }, body: null };
  return { errors, body: parsed.data };
}

export interface TradeGroup {
  id: string;
  name: string;
  items: Category[];
}

/**
 * Active SERVICE categories grouped under their parent GROUP (sorted by sortOrder), optionally filtered by a search
 * text folded for Azerbaijani (ə/e, ı/i, İ/i ...). Services without a known parent go into a group of their own id "".
 */
export function groupTrades(categories: readonly Category[], query = ''): TradeGroup[] {
  const q = tzFold(query.trim());
  const groups = new Map<string, Category>();
  for (const c of categories) if (c.kind === 'GROUP' && c.active) groups.set(c.id, c);
  const byGroup = new Map<string, Category[]>();
  for (const c of categories) {
    if (c.kind !== 'SERVICE' || !c.active) continue;
    const parent = c.parentId && groups.has(c.parentId) ? c.parentId : '';
    if (q) {
      const hay = [c.name, c.names.az, c.names.ru, c.names.en, ...(c.keywords ?? []), parent ? groups.get(parent)!.name : '']
        .map((s) => tzFold(s))
        .join(' ');
      if (!hay.includes(q)) continue;
    }
    const list = byGroup.get(parent) ?? [];
    list.push(c);
    byGroup.set(parent, list);
  }
  const out: TradeGroup[] = [];
  for (const [gid, items] of byGroup) {
    items.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    const g = gid ? groups.get(gid)! : null;
    out.push({ id: gid, name: g ? g.name : '', items });
  }
  out.sort((a, b) => {
    const ga = a.id ? groups.get(a.id)!.sortOrder : Number.MAX_SAFE_INTEGER;
    const gb = b.id ? groups.get(b.id)!.sortOrder : Number.MAX_SAFE_INTEGER;
    return ga - gb || a.name.localeCompare(b.name);
  });
  return out;
}
