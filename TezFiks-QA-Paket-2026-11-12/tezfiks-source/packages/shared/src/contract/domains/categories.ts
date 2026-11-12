import { z } from 'zod';
import { endpoint } from '../define';
import { Id, IdParams } from '../common';
import { CategoryFlow, CategoryKind, Vertical } from '../../enums';

export const CategoryNamesSchema = z.object({
  az: z.string().min(1).max(80),
  ru: z.string().min(1).max(80),
  en: z.string().min(1).max(80),
});

export const CategorySchema = z.object({
  id: Id,
  slug: z.string(),
  parentId: Id.nullable(),
  vertical: Vertical.schema,
  kind: CategoryKind.schema,
  /** Localized by Accept-Language. */
  name: z.string(),
  names: CategoryNamesSchema,
  icon: z.string().nullable(),
  featured: z.boolean(),
  flow: CategoryFlow.schema,
  emergencyAllowed: z.boolean(),
  sortOrder: z.int(),
  active: z.boolean(),
  keywords: z.array(z.string()),
});
export type Category = z.infer<typeof CategorySchema>;

export const CategoryInputSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{2,60}$/),
  parentId: Id.nullable().optional(),
  vertical: Vertical.schema,
  kind: CategoryKind.schema,
  names: CategoryNamesSchema,
  icon: z.string().max(60).nullable().optional(),
  featured: z.boolean().optional(),
  flow: CategoryFlow.schema.optional(),
  emergencyAllowed: z.boolean().optional(),
  sortOrder: z.int().optional(),
  active: z.boolean().optional(),
  keywords: z.array(z.string().max(60)).max(50).optional(),
});

export const categoriesEndpoints = {
  list: endpoint({
    method: 'GET',
    path: '/categories',
    auth: 'none',
    query: z.object({ vertical: Vertical.schema.optional() }),
    response: z.object({ items: z.array(CategorySchema) }),
    summary: 'Active categories as a flat list (groups and services); build the tree with parentId',
  }),
};

export const adminCategoriesEndpoints = {
  list: endpoint({
    method: 'GET',
    path: '/admin/categories',
    auth: 'admin',
    response: z.object({ items: z.array(CategorySchema) }),
  }),
  create: endpoint({
    method: 'POST',
    path: '/admin/categories',
    auth: 'admin',
    body: CategoryInputSchema,
    response: CategorySchema,
  }),
  update: endpoint({
    method: 'PATCH',
    path: '/admin/categories/:id',
    auth: 'admin',
    params: IdParams,
    body: CategoryInputSchema.partial(),
    response: CategorySchema,
  }),
};
