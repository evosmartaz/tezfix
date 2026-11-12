import { Injectable } from '@nestjs/common';
import type { Category as CategoryDto, CategoryFlow, CategoryKind, Locale, Vertical } from '@tezfiks/shared';
import { PrismaService, inTx, type Tx } from '../../infra/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { ApiException } from '../../common/http/api-exception';
import { CategoriesService, type CategoryRow } from './categories.service';

export interface CategoryInput {
  slug: string;
  parentId?: string | null;
  vertical: Vertical;
  kind: CategoryKind;
  names: { az: string; ru: string; en: string };
  icon?: string | null;
  featured?: boolean;
  flow?: CategoryFlow;
  emergencyAllowed?: boolean;
  sortOrder?: number;
  active?: boolean;
  keywords?: string[];
}

export interface AdminActor {
  adminId: string;
  ip: string | null;
}

interface Normalized {
  slug: string;
  parentId: string | null;
  vertical: Vertical;
  kind: CategoryKind;
  nameAz: string;
  nameRu: string;
  nameEn: string;
  icon: string | null;
  featured: boolean;
  flow: CategoryFlow;
  emergencyAllowed: boolean;
  sortOrder: number;
  active: boolean;
  keywords: string[];
}

function cleanKeywords(list: string[] | undefined): string[] {
  const out: string[] = [];
  for (const k of list ?? []) {
    const v = k.trim();
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
}

/** Admin CRUD for categories with tree validation and audit. */
@Injectable()
export class AdminCategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly categories: CategoriesService,
    private readonly audit: AuditService,
  ) {}

  async list(locale: Locale): Promise<{ items: CategoryDto[] }> {
    const rows = await this.categories.all();
    return { items: rows.map((r) => this.categories.view(r, locale)) };
  }

  async create(input: CategoryInput, actor: AdminActor, locale: Locale): Promise<CategoryDto> {
    const data: Normalized = {
      slug: input.slug,
      parentId: input.parentId ?? null,
      vertical: input.vertical,
      kind: input.kind,
      nameAz: input.names.az.trim(),
      nameRu: input.names.ru.trim(),
      nameEn: input.names.en.trim(),
      icon: input.icon ?? null,
      featured: input.featured ?? false,
      flow: input.flow ?? 'INSTANT',
      emergencyAllowed: input.emergencyAllowed ?? true,
      sortOrder: input.sortOrder ?? 0,
      active: input.active ?? true,
      keywords: cleanKeywords(input.keywords),
    };
    try {
      const row = await inTx(this.prisma, async (tx) => {
        await this.assertSlugFree(tx, data.slug, null);
        await this.validateTree(tx, data, null);
        const created = await tx.category.create({ data });
        await this.audit.log(
          {
            actorType: 'ADMIN',
            actorId: actor.adminId,
            action: 'category.create',
            entityType: 'category',
            entityId: created.id,
            before: null,
            after: this.categories.view(created, 'en'),
            ip: actor.ip,
          },
          tx,
        );
        return created;
      });
      return this.categories.view(row, locale);
    } catch (e) {
      if (isUniqueViolation(e)) throw new ApiException('CONFLICT', { field: 'slug' });
      throw e;
    }
  }

  async update(id: string, patch: Partial<CategoryInput>, actor: AdminActor, locale: Locale): Promise<CategoryDto> {
    try {
      const row = await inTx(this.prisma, async (tx) => {
        const locked = await tx.$queryRawUnsafe<Array<{ id: string }>>('SELECT id FROM categories WHERE id = $1::uuid FOR UPDATE', id);
        if (!locked.length) throw new ApiException('NOT_FOUND', { entity: 'category', id });
        const before = await tx.category.findUniqueOrThrow({ where: { id } });
        const next: Normalized = {
          slug: patch.slug ?? before.slug,
          parentId: patch.parentId === undefined ? before.parentId : patch.parentId,
          vertical: patch.vertical ?? before.vertical,
          kind: patch.kind ?? before.kind,
          nameAz: patch.names ? patch.names.az.trim() : before.nameAz,
          nameRu: patch.names ? patch.names.ru.trim() : before.nameRu,
          nameEn: patch.names ? patch.names.en.trim() : before.nameEn,
          icon: patch.icon === undefined ? before.icon : patch.icon,
          featured: patch.featured ?? before.featured,
          flow: patch.flow ?? before.flow,
          emergencyAllowed: patch.emergencyAllowed ?? before.emergencyAllowed,
          sortOrder: patch.sortOrder ?? before.sortOrder,
          active: patch.active ?? before.active,
          keywords: patch.keywords === undefined ? before.keywords : cleanKeywords(patch.keywords),
        };
        if (next.slug !== before.slug) await this.assertSlugFree(tx, next.slug, id);
        await this.validateTree(tx, next, before);
        const updated = await tx.category.update({ where: { id }, data: next });
        await this.audit.log(
          {
            actorType: 'ADMIN',
            actorId: actor.adminId,
            action: 'category.update',
            entityType: 'category',
            entityId: id,
            before: this.categories.view(before, 'en'),
            after: this.categories.view(updated, 'en'),
            ip: actor.ip,
          },
          tx,
        );
        return updated;
      });
      return this.categories.view(row, locale);
    } catch (e) {
      if (isUniqueViolation(e)) throw new ApiException('CONFLICT', { field: 'slug' });
      throw e;
    }
  }

  private async assertSlugFree(tx: Tx, slug: string, selfId: string | null): Promise<void> {
    const existing = await tx.category.findUnique({ where: { slug }, select: { id: true } });
    if (existing && existing.id !== selfId) throw new ApiException('CONFLICT', { field: 'slug', slug });
  }

  /**
   * GROUP: no parent; its children must stay in the same vertical; cannot become a SERVICE while it has children.
   * SERVICE: parent required, must be an active GROUP of the same vertical; a service has no children.
   */
  private async validateTree(tx: Tx, next: Normalized, before: CategoryRow | null): Promise<void> {
    const fail = (reason: string, field = 'parentId') => new ApiException('VALIDATION_FAILED', { field, reason });
    const selfId = before?.id ?? null;
    if (next.kind === 'GROUP') {
      if (next.parentId) throw fail('group_cannot_have_parent');
      if (selfId) {
        const mismatched = await tx.category.count({ where: { parentId: selfId, vertical: { not: next.vertical } } });
        if (mismatched > 0) throw fail('children_vertical_mismatch', 'vertical');
      }
      return;
    }
    if (!next.parentId) throw fail('service_requires_parent');
    if (selfId && next.parentId === selfId) throw fail('parent_is_self');
    const parent = await tx.category.findUnique({ where: { id: next.parentId } });
    if (!parent) throw fail('parent_not_found');
    if (parent.kind !== 'GROUP') throw fail('parent_not_group');
    if (!parent.active) throw fail('parent_inactive');
    if (parent.vertical !== next.vertical) throw fail('parent_vertical_mismatch', 'vertical');
    if (selfId && before?.kind === 'GROUP') {
      const children = await tx.category.count({ where: { parentId: selfId } });
      if (children > 0) throw fail('group_has_children', 'kind');
    }
  }
}
