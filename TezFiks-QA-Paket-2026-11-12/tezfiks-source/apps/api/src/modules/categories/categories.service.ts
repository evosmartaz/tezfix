import { Injectable } from '@nestjs/common';
import type { Category as CategoryDto, CategoryRef, Locale, Vertical } from '@tezfiks/shared';
import type { Category } from '../../generated/prisma/client';
import { PrismaService, type Db } from '../../infra/prisma.service';
import { ApiException } from '../../common/http/api-exception';

export type CategoryRow = Category;

const ORDER = [{ sortOrder: 'asc' as const }, { slug: 'asc' as const }];

/** Categories (groups + services): lookups, flow checks and localized views. Exported for other lanes. */
@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Category by id; NOT_FOUND when missing. */
  async get(id: string, db: Db = this.prisma): Promise<CategoryRow> {
    const c = await this.find(id, db);
    if (!c) throw new ApiException('NOT_FOUND', { entity: 'category', id });
    return c;
  }

  /** Category by id or null. */
  async find(id: string, db: Db = this.prisma): Promise<CategoryRow | null> {
    if (!isUuid(id)) return null;
    return db.category.findUnique({ where: { id } });
  }

  /** Category by slug; NOT_FOUND when missing. */
  async getBySlug(slug: string, db: Db = this.prisma): Promise<CategoryRow> {
    const c = await db.category.findUnique({ where: { slug } });
    if (!c) throw new ApiException('NOT_FOUND', { entity: 'category', slug });
    return c;
  }

  /**
   * An active SERVICE category bookable through the instant flow.
   * missing -> NOT_FOUND, inactive (or inactive group) -> CATEGORY_INACTIVE, GROUP -> VALIDATION_FAILED,
   * flow QUOTE -> CATEGORY_REQUIRES_QUOTE.
   */
  async requireInstantService(id: string, db: Db = this.prisma): Promise<CategoryRow> {
    const c = await this.requireActiveService(id, db);
    if (c.flow === 'QUOTE') throw new ApiException('CATEGORY_REQUIRES_QUOTE', { categoryId: c.id, slug: c.slug });
    return c;
  }

  /** An active SERVICE category with flow QUOTE (B2B projects). flow INSTANT -> CATEGORY_NOT_INSTANT. */
  async requireQuoteService(id: string, db: Db = this.prisma): Promise<CategoryRow> {
    const c = await this.requireActiveService(id, db);
    if (c.flow === 'INSTANT') throw new ApiException('CATEGORY_NOT_INSTANT', { categoryId: c.id, slug: c.slug });
    return c;
  }

  private async requireActiveService(id: string, db: Db): Promise<CategoryRow> {
    const c = await this.find(id, db);
    if (!c) throw new ApiException('NOT_FOUND', { entity: 'category', id });
    if (c.kind !== 'SERVICE') throw new ApiException('VALIDATION_FAILED', { field: 'categoryId', reason: 'category_is_group' });
    if (!c.active) throw new ApiException('CATEGORY_INACTIVE', { categoryId: c.id, slug: c.slug });
    if (c.parentId) {
      const parent = await db.category.findUnique({ where: { id: c.parentId }, select: { active: true } });
      if (parent && !parent.active) throw new ApiException('CATEGORY_INACTIVE', { categoryId: c.id, slug: c.slug });
    }
    return c;
  }

  /** Localized display name. */
  name(category: Pick<CategoryRow, 'nameAz' | 'nameRu' | 'nameEn'>, locale: Locale): string {
    if (locale === 'ru') return category.nameRu;
    if (locale === 'en') return category.nameEn;
    return category.nameAz;
  }

  ref(category: CategoryRow, locale: Locale): CategoryRef {
    return {
      id: category.id,
      slug: category.slug,
      name: this.name(category, locale),
      icon: category.icon ?? null,
      vertical: category.vertical,
    };
  }

  /** Refs keyed by id (unknown ids are skipped). */
  async refs(ids: Iterable<string>, locale: Locale, db: Db = this.prisma): Promise<Map<string, CategoryRef>> {
    const unique = [...new Set([...ids].filter(isUuid))];
    const out = new Map<string, CategoryRef>();
    if (!unique.length) return out;
    const rows = await db.category.findMany({ where: { id: { in: unique } } });
    for (const r of rows) out.set(r.id, this.ref(r, locale));
    return out;
  }

  /** Full contract view of a category. */
  view(category: CategoryRow, locale: Locale): CategoryDto {
    return {
      id: category.id,
      slug: category.slug,
      parentId: category.parentId ?? null,
      vertical: category.vertical,
      kind: category.kind,
      name: this.name(category, locale),
      names: { az: category.nameAz, ru: category.nameRu, en: category.nameEn },
      icon: category.icon ?? null,
      featured: category.featured,
      flow: category.flow,
      emergencyAllowed: category.emergencyAllowed,
      sortOrder: category.sortOrder,
      active: category.active,
      keywords: category.keywords ?? [],
    };
  }

  /** Active categories (groups + services) visible to clients: services under an inactive group are hidden. */
  async activeCategories(vertical?: Vertical, db: Db = this.prisma): Promise<CategoryRow[]> {
    const rows = await db.category.findMany({ where: { active: true, ...(vertical ? { vertical } : {}) }, orderBy: ORDER });
    const activeGroupIds = new Set(rows.filter((r) => r.kind === 'GROUP').map((r) => r.id));
    return rows.filter((r) => r.kind === 'GROUP' || !r.parentId || activeGroupIds.has(r.parentId));
  }

  /** Active SERVICE categories (under active groups), optionally for one vertical. */
  async activeServices(vertical?: Vertical, db: Db = this.prisma): Promise<CategoryRow[]> {
    return (await this.activeCategories(vertical, db)).filter((r) => r.kind === 'SERVICE');
  }

  /** Every category including inactive ones (admin). */
  async all(db: Db = this.prisma): Promise<CategoryRow[]> {
    return db.category.findMany({ orderBy: ORDER });
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(v: string): boolean {
  return UUID_RE.test(v);
}
