import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../helpers/app';
import { loadEnv } from '../../src/config/env';
import { FILES_PURGE_CRON, FILES_PURGE_JOB } from '../../src/modules/files/files.service';

// Boots the app with real BullMQ (ROLE=api: queue only, no worker consuming jobs) to prove that the daily purge cron is
// really registered at startup (JobsService.repeat is a no-op in manual mode, which every other test uses).
describe('A1 files: daily purge cron (BullMQ job scheduler)', () => {
  let t: TestApp;
  const saved = { JOBS_MODE: process.env.JOBS_MODE, ROLE: process.env.ROLE };

  beforeAll(async () => {
    process.env.JOBS_MODE = 'bullmq';
    process.env.ROLE = 'api';
    // A clean Redis DB first, so a scheduler left by an earlier run cannot make this test pass.
    const env = loadEnv();
    const r = new Redis(env.REDIS_URL);
    await r.flushdb();
    await r.quit();
    t = await createTestApp();
  });

  afterAll(async () => {
    await t?.redis.client.flushdb();
    await t?.close();
    process.env.JOBS_MODE = saved.JOBS_MODE;
    process.env.ROLE = saved.ROLE;
  });

  it('registers files.purge as a daily repeatable job (Asia/Baku) when the app starts', async () => {
    expect(t.jobs.mode).toBe('bullmq');
    const env = loadEnv();
    const queue = new Queue('tezfiks', { connection: t.redis.client.duplicate(), prefix: `${env.REDIS_PREFIX}q` });
    try {
      const scheduler = await queue.getJobScheduler(FILES_PURGE_JOB);
      expect(scheduler).toBeTruthy();
      expect(scheduler).toMatchObject({ pattern: FILES_PURGE_CRON, tz: 'Asia/Baku' });
      // once a day: minute and hour fixed, every day of every month
      expect(FILES_PURGE_CRON.split(' ').slice(2)).toEqual(['*', '*', '*']);
      // the next run is scheduled within the next 24 hours
      expect(scheduler!.next).toBeGreaterThan(Date.now());
      expect(scheduler!.next! - Date.now()).toBeLessThanOrEqual(24 * 3600_000);
    } finally {
      await queue.close();
    }
  });
});
