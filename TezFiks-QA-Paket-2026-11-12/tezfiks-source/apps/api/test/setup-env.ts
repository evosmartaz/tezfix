// Runs in every test worker before any test file. Values can be overridden from the shell (parallel lanes use
// their own TEST_DB_NAME and TEST_REDIS_DB so they never share state).
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const base = process.env.TEST_PG_BASE ?? 'postgresql://tezfiks:tezfiks@127.0.0.1:55432';
const dbName = process.env.TEST_DB_NAME ?? 'tezfiks_test';
const redisDb = process.env.TEST_REDIS_DB ?? '1';
const redisBase = process.env.TEST_REDIS_BASE ?? 'redis://127.0.0.1:56379';

Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: `${base}/${dbName}`,
  REDIS_URL: `${redisBase}/${redisDb}`,
  REDIS_PREFIX: `tzt${redisDb}`,
  JWT_SECRET: 'test-secret-test-secret-test-secret-test-secret',
  JOBS_MODE: 'manual',
  ROLE: 'all',
  OTP_CHANNEL: 'console',
  OTP_DEV_ECHO: 'true',
  CONTRACT_VALIDATE_RESPONSES: 'true',
  DEMO_MODE: process.env.TEST_DEMO_MODE ?? 'false',
  // The suite exercises card payments through the fake provider without DEMO_MODE (production refuses this opt-in;
  // test/a2/production-guards.spec.ts covers the API with test payments off).
  PAYMENTS_TEST_MODE: 'true',
  STORAGE_DRIVER: 'local',
  STORAGE_LOCAL_DIR: resolve(tmpdir(), `tezfiks-test-uploads-${dbName}`),
  PUBLIC_BASE_URL: 'http://127.0.0.1:3000',
  PUSH_PROVIDER: 'log',
  LOG_LEVEL: 'error',
});
delete process.env.ANTHROPIC_API_KEY;
delete process.env.GOOGLE_MAPS_SERVER_KEY;
