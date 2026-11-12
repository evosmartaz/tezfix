import { tzFold, type Category, type Vertical } from '@tezfiks/shared';

/** Number of featured tiles on the home screen per vertical (board 02 B1/B2). */
export const FEATURED_TILES = 6;

/** MaterialCommunityIcons glyph used when a category has no icon or an unknown one. */
export const FALLBACK_CATEGORY_ICON = 'tools';

export interface CategoryGroupNode {
  group: Category | null;
  services: Category[];
}

function bySort(a: Category, b: Category): number {
  return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
}

export function isService(c: Category): boolean {
  return c.kind === 'SERVICE' && c.active;
}

/** Active services of a vertical (or all) in catalogue order: by their group's order, then their own. */
export function servicesOf(items: Category[], vertical?: Vertical | null): Category[] {
  const groupOrder = new Map(items.filter((c) => c.kind === 'GROUP').map((g) => [g.id, g.sortOrder]));
  const rank = (c: Category) => (c.parentId && groupOrder.has(c.parentId) ? (groupOrder.get(c.parentId) as number) : Number.MAX_SAFE_INTEGER);
  return items
    .filter((c) => isService(c) && (!vertical || c.vertical === vertical))
    .sort((a, b) => rank(a) - rank(b) || bySort(a, b));
}

/**
 * Groups → their active services, in sort order (board 02 "Bütün kateqoriyalar"). Services whose parent is missing
 * (or that have no parent) are collected in a trailing node with `group: null`. Empty groups are dropped.
 */
export function buildCategoryTree(items: Category[], vertical?: Vertical | null): CategoryGroupNode[] {
  const groups = items.filter((c) => c.kind === 'GROUP' && c.active && (!vertical || c.vertical === vertical)).sort(bySort);
  const groupIds = new Set(groups.map((g) => g.id));
  const byParent = new Map<string, Category[]>();
  const orphans: Category[] = [];
  for (const s of servicesOf(items, vertical)) {
    if (s.parentId && groupIds.has(s.parentId)) {
      const list = byParent.get(s.parentId) ?? [];
      list.push(s);
      byParent.set(s.parentId, list);
    } else {
      orphans.push(s);
    }
  }
  const nodes: CategoryGroupNode[] = groups
    .map((group) => ({ group, services: byParent.get(group.id) ?? [] }))
    .filter((n) => n.services.length > 0);
  if (orphans.length) nodes.push({ group: null, services: orphans });
  return nodes;
}

/**
 * Home tiles: the featured services of the vertical first, then the remaining services in catalogue order,
 * up to `count` (so a vertical with fewer featured services still shows a full grid).
 */
export function featuredServices(items: Category[], vertical: Vertical, count = FEATURED_TILES): Category[] {
  const services = servicesOf(items, vertical);
  const featured = services.filter((s) => s.featured);
  const rest = services.filter((s) => !s.featured);
  return [...featured, ...rest].slice(0, count);
}

/** Folded search haystack of a service: names in every language, slug, keywords and the parent group's names. */
function haystack(c: Category, parent: Category | undefined): string[] {
  const parts = [c.name, c.names.az, c.names.ru, c.names.en, c.slug.replace(/-/g, ' '), ...c.keywords];
  if (parent) parts.push(parent.name, parent.names.az, parent.names.ru, parent.names.en);
  return parts.map((p) => tzFold(p));
}

/**
 * Searches active services with Azerbaijani/Russian folding (`tzFold`: İ/I/ı → i, ə → e, ş → s ...).
 * Every query word must match the start of a word in the haystack, or appear inside it when longer than 2 letters.
 * Results: name-prefix matches first, then other matches, each in catalogue order.
 */
export function searchCategories(items: Category[], query: string, vertical?: Vertical | null): Category[] {
  const words = tzFold(query ?? '').split(/\s+/).filter(Boolean);
  const services = servicesOf(items, vertical);
  if (words.length === 0) return services;
  const byId = new Map(items.map((c) => [c.id, c]));
  const scored: Array<{ c: Category; score: number }> = [];
  for (const c of services) {
    const hay = haystack(c, c.parentId ? byId.get(c.parentId) : undefined);
    const tokens = hay.flatMap((h) => h.split(/[\s/,.()-]+/).filter(Boolean));
    const all = words.every((w) => tokens.some((tk) => tk.startsWith(w)) || (w.length > 2 && hay.some((h) => h.includes(w))));
    if (!all) continue;
    const names = [c.name, c.names.az, c.names.ru, c.names.en].map((n) => tzFold(n));
    const prefix = names.some((n) => n.startsWith(words[0]));
    scored.push({ c, score: prefix ? 0 : 1 });
  }
  return scored.sort((a, b) => a.score - b.score).map((s) => s.c); // stable: catalogue order within a score
}

/** Icon name for MaterialCommunityIcons, falling back when missing or unknown to the glyph map. */
export function categoryIcon(icon: string | null | undefined, glyphMap?: Record<string, unknown>): string {
  const name = (icon ?? '').trim();
  if (!name) return FALLBACK_CATEGORY_ICON;
  if (glyphMap && !(name in glyphMap)) return FALLBACK_CATEGORY_ICON;
  return name;
}

export function findCategory(items: Category[] | undefined, id: string | null | undefined): Category | null {
  if (!items || !id) return null;
  return items.find((c) => c.id === id) ?? null;
}

/** The form a service is ordered with: quote-only services (flow QUOTE) go to the business request (board 02 D). */
export function categoryFormHref(
  c: Pick<Category, 'id' | 'flow'>,
  extra: Record<string, string> = {},
): { pathname: '/request/new' | '/project/new'; params: Record<string, string> } {
  return { pathname: c.flow === 'QUOTE' ? '/project/new' : '/request/new', params: { categoryId: c.id, ...extra } };
}
