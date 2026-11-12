import type { Category, ClassifyPhotoResponse } from '@tezfiks/shared';
import { findCategory } from './categories';

/** Which services to suggest after classification: the AI pick and its candidates, catalogue services only. */
export function suggestionsFrom(result: ClassifyPhotoResponse | null, categories: Category[]): Category[] {
  if (!result) return [];
  const ids = [result.categoryId, ...result.candidates.map((c) => c.categoryId)].filter((x): x is string => !!x);
  const out: Category[] = [];
  for (const id of ids) {
    const c = findCategory(categories, id);
    if (c && c.kind === 'SERVICE' && !out.some((o) => o.id === c.id)) out.push(c);
  }
  return out;
}

/** The service to open directly: only a confident AI pick that is an active catalogue service. */
export function confidentPick(result: ClassifyPhotoResponse | null, categories: Category[]): Category | null {
  if (!result || result.status !== 'ok') return null;
  const c = findCategory(categories, result.categoryId);
  return c && c.kind === 'SERVICE' && c.active ? c : null;
}
