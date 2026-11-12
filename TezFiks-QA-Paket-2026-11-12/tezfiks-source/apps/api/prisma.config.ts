import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * Prisma 7 CLI configuration. The CLI (migrate, studio) connects with DIRECT_URL when set
 * (Supabase: direct or session-pooler connection), otherwise DATABASE_URL.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed/index.ts',
  },
  datasource: {
    url: process.env.DIRECT_URL || process.env.DATABASE_URL || 'postgresql://tezfiks:tezfiks@127.0.0.1:55432/tezfiks',
  },
});
