import { FALLBACK_CATEGORY_ICON, buildCategoryTree, categoryIcon, featuredServices, findCategory, searchCategories, servicesOf } from '../src/lib/categories';
import { IDS, categories } from './fixtures';

const items = categories();
const slugs = (list: { slug: string }[]) => list.map((c) => c.slug);

describe('category tree and featured tiles', () => {
  it('lists only active services of a vertical, in sort order', () => {
    expect(slugs(servicesOf(items, 'HOME'))).not.toContain('old-service');
    expect(slugs(servicesOf(items, 'AUTO'))).toEqual(['battery', 'towing']);
    expect(servicesOf(items).every((c) => c.kind === 'SERVICE')).toBe(true);
  });

  it('groups services under their groups, ordered, dropping empty groups', () => {
    const tree = buildCategoryTree(items, 'HOME');
    expect(tree.map((n) => n.group?.slug)).toEqual(['construction', 'home-systems', 'finishing']);
    expect(slugs(tree[1].services)).toEqual(['plumbing', 'electrical', 'air-conditioning', 'heating', 'doors-locks']);
    expect(buildCategoryTree(items, 'AUTO').map((n) => n.group?.slug)).toEqual(['auto']);
  });

  it('puts services without a known group in a trailing "other" node', () => {
    const orphan = { ...items[4], id: '20000000-0000-4000-a000-0000000000ff', slug: 'orphan', parentId: null };
    const tree = buildCategoryTree([...items, orphan], 'HOME');
    expect(tree[tree.length - 1].group).toBeNull();
    expect(slugs(tree[tree.length - 1].services)).toEqual(['orphan']);
  });

  it('home shows 6 tiles per vertical: featured first, then catalogue order', () => {
    const home = featuredServices(items, 'HOME');
    expect(home).toHaveLength(6);
    expect(slugs(home)).toEqual(['plumbing', 'electrical', 'air-conditioning', 'doors-locks', 'painting', 'furniture']);
    // AUTO has one featured service; the grid is filled with the others.
    expect(slugs(featuredServices(items, 'AUTO'))).toEqual(['battery', 'towing']);
  });
});

describe('category search (tzFold)', () => {
  it('matches names regardless of case and Azerbaijani letters', () => {
    expect(slugs(searchCategories(items, 'santex'))).toEqual(['plumbing']);
    expect(slugs(searchCategories(items, 'SANTEXNİK'))).toEqual(['plumbing']);
    expect(slugs(searchCategories(items, 'qapi'))).toEqual(['doors-locks']);
    expect(slugs(searchCategories(items, 'QAPI-KİLİD'))).toContain('doors-locks');
    expect(slugs(searchCategories(items, 'tekər'))).toEqual(['towing']);
  });

  it('matches keywords and other languages', () => {
    expect(slugs(searchCategories(items, 'kran'))).toEqual(['plumbing']);
    expect(slugs(searchCategories(items, 'КРАН'))).toEqual(['plumbing']);
    expect(slugs(searchCategories(items, 'electric'))).toEqual(['electrical']);
    expect(slugs(searchCategories(items, 'rəngləmə'))).toEqual(['painting']);
    expect(slugs(searchCategories(items, 'rengleme'))).toEqual(['painting']);
  });

  it('searches both verticals unless one is given, and never returns inactive services or groups', () => {
    expect(slugs(searchCategories(items, 'akkum'))).toEqual(['battery']);
    expect(searchCategories(items, 'akkum', 'HOME')).toEqual([]);
    expect(searchCategories(items, 'köhnə')).toEqual([]);
    expect(searchCategories(items, 'Ev sistemləri').every((c) => c.kind === 'SERVICE')).toBe(true);
  });

  it('every word must match; group names count as context; empty query lists everything', () => {
    expect(slugs(searchCategories(items, 'santexnik kran'))).toEqual(['plumbing']);
    expect(searchCategories(items, 'santexnik zzz')).toEqual([]);
    expect(slugs(searchCategories(items, 'tamamlama'))).toEqual(['painting', 'furniture']);
    expect(searchCategories(items, '   ')).toHaveLength(servicesOf(items).length);
  });

  it('name-prefix matches rank before keyword matches', () => {
    const k = { ...items[5], id: '20000000-0000-4000-a000-0000000000fe', slug: 'kondisioner-2', name: 'Soyuducu', names: { az: 'Soyuducu', ru: 'Холодильник', en: 'Fridge' }, keywords: ['kondisioner'] };
    expect(slugs(searchCategories([...items, k], 'kondisioner'))).toEqual(['air-conditioning', 'kondisioner-2']);
  });
});

describe('category helpers', () => {
  it('falls back to a generic icon when the icon is missing or unknown to the glyph map', () => {
    expect(categoryIcon(null)).toBe(FALLBACK_CATEGORY_ICON);
    expect(categoryIcon('  ')).toBe(FALLBACK_CATEGORY_ICON);
    expect(categoryIcon('pipe-wrench', { 'pipe-wrench': 1 })).toBe('pipe-wrench');
    expect(categoryIcon('not-a-real-icon', { 'pipe-wrench': 1 })).toBe(FALLBACK_CATEGORY_ICON);
    expect(categoryIcon('pipe-wrench')).toBe('pipe-wrench');
  });

  it('finds a category by id', () => {
    expect(findCategory(items, IDS.plumbing)?.slug).toBe('plumbing');
    expect(findCategory(items, 'nope')).toBeNull();
    expect(findCategory(undefined, IDS.plumbing)).toBeNull();
  });
});
