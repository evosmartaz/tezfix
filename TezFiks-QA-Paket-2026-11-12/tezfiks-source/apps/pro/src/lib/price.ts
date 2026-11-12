import { keypadToMinor, minorToKeypad } from '@tezfiks/mobile';

/** Contract limit of each price part (PriceInputSchema: 0 .. 100 000 AZN). */
export const PRICE_PART_MAX = 100_000_00;

export type PriceField = 'labor' | 'materials';

export interface PriceDraft {
  /** Keypad strings ("35", "10.5"). */
  labor: string;
  materials: string;
}

export interface PriceTotals {
  labor: number;
  materials: number;
  total: number;
}

/** Board 03 B4: İş haqqı + Material xərci = Yekun məbləğ (integer qəpik). */
export function priceTotals(draft: PriceDraft): PriceTotals {
  const labor = keypadToMinor(draft.labor);
  const materials = keypadToMinor(draft.materials);
  return { labor, materials, total: labor + materials };
}

export type PriceError = 'zero' | 'tooLarge';

/**
 * Validates the price before "Qiyməti təsdiqlə və işi bitir". A zero total is only valid for a guarantee re-fix
 * (spec 4.6: price fixed at 0); each part is capped by the contract.
 */
export function validatePrice(draft: PriceDraft, opts: { allowZero?: boolean } = {}): { error: PriceError | null; body: { labor: number; materials: number } | null } {
  const t = priceTotals(draft);
  if (t.labor > PRICE_PART_MAX || t.materials > PRICE_PART_MAX) return { error: 'tooLarge', body: null };
  if (t.total <= 0 && !opts.allowZero) return { error: 'zero', body: null };
  return { error: null, body: { labor: t.labor, materials: t.materials } };
}

/** Pre-fills the keypad from an existing price (re-proposal after an admin correction). */
export function draftFromPrice(price: { labor: number; materials: number } | null | undefined): PriceDraft {
  return { labor: minorToKeypad(price?.labor ?? 0), materials: minorToKeypad(price?.materials ?? 0) };
}

/** Keypad strings shown as amounts: "" → "0.00", "35" → "35.00", "4.5" → "4.50". */
export function keypadDisplay(value: string): string {
  const minor = keypadToMinor(value);
  return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, '0')}`;
}
