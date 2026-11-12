import type { PrismaService } from '../../src/infra/prisma.service';
import { seedCategories, seedPlatformAccounts } from '../../prisma/seed/base';

/** Empties every table (except the migrations table), then re-seeds categories and platform accounts. */
export async function resetDb(prisma: PrismaService): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<Array<{ tablename: string }>>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
  );
  if (rows.length) {
    await prisma.$executeRawUnsafe(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  }
  await prisma.$executeRawUnsafe(`ALTER SEQUENCE service_requests_number_seq RESTART WITH 1000`);
  await prisma.$executeRawUnsafe(`ALTER SEQUENCE projects_number_seq RESTART WITH 100`);
  await prisma.$executeRawUnsafe(`ALTER SEQUENCE invoice_number_seq RESTART WITH 1`);
  await seedCategories(prisma as never);
  await seedPlatformAccounts(prisma as never);
}
