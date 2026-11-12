import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client';
import { seedBase } from './base';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    await seedBase(prisma as never, {
      email: process.env.ADMIN_BOOTSTRAP_EMAIL,
      password: process.env.ADMIN_BOOTSTRAP_PASSWORD,
      name: process.env.ADMIN_BOOTSTRAP_NAME,
    });
    // eslint-disable-next-line no-console
    console.log('Seed complete: categories, platform accounts, bootstrap admin');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
