import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import pg from 'pg';

/** Creates the per-lane test database if needed and applies migrations once per test run. */
export default async function setup(): Promise<void> {
  const base = process.env.TEST_PG_BASE ?? 'postgresql://tezfiks:tezfiks@127.0.0.1:55432';
  const dbName = process.env.TEST_DB_NAME ?? 'tezfiks_test';
  if (!/^[a-z0-9_]+$/.test(dbName)) throw new Error(`Invalid TEST_DB_NAME ${dbName}`);
  const admin = new pg.Client({ connectionString: `${base}/postgres` });
  await admin.connect();
  try {
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (!exists.rowCount) await admin.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.end();
  }
  const url = `${base}/${dbName}`;
  execSync('npx prisma migrate deploy', {
    cwd: resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
    stdio: 'pipe',
  });
}
