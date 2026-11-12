import { CATEGORY_TREE } from './categories.data';
import { hashPassword } from '../../src/common/auth/password';

const PLATFORM_OWNER_ID = '00000000-0000-0000-0000-000000000000';
const PLATFORM_KINDS = ['REVENUE', 'PROMO', 'EXTERNAL', 'PAYOUTS_IN_TRANSIT', 'ADJUSTMENTS'] as const;

/** Minimal structural type so the seed works with the generated client or a transaction client. */
type SeedDb = {
  category: { upsert(args: unknown): Promise<{ id: string }> };
  ledgerAccount: { upsert(args: unknown): Promise<unknown> };
  adminUser: { count(): Promise<number>; create(args: unknown): Promise<unknown> };
};

export async function seedCategories(db: SeedDb): Promise<number> {
  let count = 0;
  let groupOrder = 0;
  for (const group of CATEGORY_TREE) {
    const g = await db.category.upsert({
      where: { slug: group.slug },
      create: {
        slug: group.slug,
        vertical: group.vertical,
        kind: 'GROUP',
        nameAz: group.az,
        nameRu: group.ru,
        nameEn: group.en,
        icon: group.icon,
        sortOrder: groupOrder,
        keywords: group.keywords ?? [],
      },
      update: { vertical: group.vertical, nameAz: group.az, nameRu: group.ru, nameEn: group.en, icon: group.icon, sortOrder: groupOrder },
    });
    groupOrder += 10;
    count++;
    let order = 0;
    for (const c of group.children) {
      await db.category.upsert({
        where: { slug: c.slug },
        create: {
          slug: c.slug,
          parentId: g.id,
          vertical: group.vertical,
          kind: 'SERVICE',
          nameAz: c.az,
          nameRu: c.ru,
          nameEn: c.en,
          icon: c.icon,
          featured: c.featured ?? false,
          flow: c.flow ?? 'INSTANT',
          emergencyAllowed: c.emergencyAllowed ?? (c.flow !== 'QUOTE'),
          keywords: c.keywords ?? [],
          sortOrder: order,
        },
        update: {
          parentId: g.id,
          vertical: group.vertical,
          nameAz: c.az,
          nameRu: c.ru,
          nameEn: c.en,
          icon: c.icon,
          featured: c.featured ?? false,
          flow: c.flow ?? 'INSTANT',
          emergencyAllowed: c.emergencyAllowed ?? (c.flow !== 'QUOTE'),
          keywords: c.keywords ?? [],
          sortOrder: order,
        },
      });
      order += 10;
      count++;
    }
  }
  return count;
}

export async function seedPlatformAccounts(db: SeedDb): Promise<void> {
  for (const kind of PLATFORM_KINDS) {
    await db.ledgerAccount.upsert({
      where: { ownerType_ownerId_kind_currency: { ownerType: 'PLATFORM', ownerId: PLATFORM_OWNER_ID, kind, currency: 'AZN' } },
      create: { ownerType: 'PLATFORM', ownerId: PLATFORM_OWNER_ID, kind, currency: 'AZN', allowNegative: kind !== 'REVENUE' },
      update: {},
    });
  }
}

export async function seedBootstrapAdmin(
  db: SeedDb,
  admin: { email?: string; password?: string; name?: string },
): Promise<boolean> {
  if (!admin.email || !admin.password) return false;
  if ((await db.adminUser.count()) > 0) return false;
  await db.adminUser.create({
    data: { email: admin.email.toLowerCase(), passwordHash: await hashPassword(admin.password), name: admin.name ?? 'TezFiks Admin', role: 'ADMIN' },
  });
  return true;
}

export async function seedBase(db: SeedDb, admin: { email?: string; password?: string; name?: string } = {}): Promise<void> {
  await seedCategories(db);
  await seedPlatformAccounts(db);
  await seedBootstrapAdmin(db, admin);
}
