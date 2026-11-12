import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Queue } from 'bullmq';
import { createTestApp, type TestApp } from './helpers/app';
import { ENV, type Env } from '../src/config/env';
import { JobsService } from '../src/infra/jobs.service';
import { Clock } from '../src/infra/clock';

describe('JobsService in bullmq mode', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });

  it('keeps cron schedules registered before the queue starts and installs them on bootstrap', async () => {
    const env = { ...t.app.get<Env>(ENV), JOBS_MODE: 'bullmq', ROLE: 'api', REDIS_PREFIX: 'tf-jobs-spec:' } as Env;
    const jobs = new JobsService(env, t.redis, new Clock());
    // A feature module may call repeat() from onModuleInit, before JobsService.onApplicationBootstrap created the queue.
    await jobs.repeat('spec.nightly', '15 4 * * *', { k: 1 });
    jobs.onApplicationBootstrap();
    await jobs.whenReady();
    await jobs.repeat('spec.weekly', '0 9 * * 1');

    const reader = new Queue('tezfiks', { connection: t.redis.client.duplicate(), prefix: 'tf-jobs-spec:q' });
    try {
      const schedulers = await reader.getJobSchedulers();
      expect(schedulers.map((s) => [s.key, s.pattern, s.tz]).sort()).toEqual([
        ['spec.nightly', '15 4 * * *', 'Asia/Baku'],
        ['spec.weekly', '0 9 * * 1', 'Asia/Baku'],
      ]);
      for (const s of schedulers) await reader.removeJobScheduler(s.key);
    } finally {
      await reader.close();
      await jobs.onModuleDestroy();
    }
  });

  /** A JobsService with a worker (ROLE=all) on its own queue prefix, plus a reader on the same queue. */
  async function bullJobs(prefix: string) {
    const env = { ...t.app.get<Env>(ENV), JOBS_MODE: 'bullmq', ROLE: 'all', REDIS_PREFIX: prefix } as Env;
    const jobs = new JobsService(env, t.redis, new Clock());
    const reader = new Queue('tezfiks', { connection: t.redis.client.duplicate(), prefix: `${prefix}q` });
    await reader.obliterate({ force: true }).catch(() => undefined);
    return {
      jobs,
      reader,
      async close() {
        await jobs.onModuleDestroy();
        await reader.obliterate({ force: true }).catch(() => undefined);
        await reader.close();
      },
    };
  }

  async function waitFor(check: () => Promise<boolean>, ms = 10_000): Promise<void> {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      if (await check()) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error('timed out');
  }

  it('a handler that re-schedules its own job id (dispatch steps, auto-complete) leaves the next run behind', async () => {
    const q = await bullJobs('tf-jobs-self:');
    const runs: number[] = [];
    q.jobs.register('spec.self', async (data: { n: number }) => {
      runs.push(data.n);
      if (data.n < 3) await q.jobs.schedule('spec.self', { n: data.n + 1 }, { jobId: 'spec:self:req-1', delayMs: data.n === 1 ? 50 : 60_000 });
    });
    try {
      q.jobs.onApplicationBootstrap();
      await q.jobs.whenReady();
      await q.jobs.schedule('spec.self', { n: 1 }, { jobId: 'spec:self:req-1' });
      // Run 1 schedules run 2 from inside its own handler (same id), run 2 schedules run 3 (60 s ahead).
      await waitFor(async () => runs.length >= 2 && (await q.reader.getDelayed()).length === 1);
      expect(runs).toEqual([1, 2]);
      const delayed = await q.reader.getDelayed();
      expect(delayed.map((j) => [j.name, j.data])).toEqual([['spec.self', { n: 3 }]]);
      // The pending run can still be cancelled by its logical id.
      await q.jobs.cancel('spec:self:req-1');
      expect(await q.reader.getDelayed()).toHaveLength(0);
    } finally {
      await q.close();
    }
  });

  it('schedule with the same id replaces the pending job, cancel removes it, and a completed id can be scheduled again', async () => {
    const q = await bullJobs('tf-jobs-replace:');
    const runs: string[] = [];
    q.jobs.register('spec.replace', async (data: { v: string }) => {
      runs.push(data.v);
    });
    try {
      q.jobs.onApplicationBootstrap();
      await q.jobs.whenReady();
      await q.jobs.schedule('spec.replace', { v: 'a' }, { jobId: 'spec:x', delayMs: 60_000 });
      await q.jobs.schedule('spec.replace', { v: 'b' }, { jobId: 'spec:x', delayMs: 120_000 });
      let delayed = await q.reader.getDelayed();
      expect(delayed.map((j) => j.data)).toEqual([{ v: 'b' }]);
      await q.jobs.cancel('spec:x');
      expect(await q.reader.getDelayed()).toHaveLength(0);

      // Completed jobs are kept (removeOnComplete keeps the last 1000): the same id must still schedule a new run.
      await q.jobs.schedule('spec.replace', { v: 'c' }, { jobId: 'spec:y' });
      await waitFor(async () => runs.includes('c') && (await q.reader.getCompletedCount()) >= 1);
      await q.jobs.schedule('spec.replace', { v: 'd' }, { jobId: 'spec:y', delayMs: 60_000 });
      delayed = await q.reader.getDelayed();
      expect(delayed.map((j) => j.data)).toEqual([{ v: 'd' }]);
      // Jobs without an id are independent.
      await q.jobs.schedule('spec.replace', { v: 'e' }, { delayMs: 60_000 });
      await q.jobs.schedule('spec.replace', { v: 'f' }, { delayMs: 60_000 });
      expect((await q.reader.getDelayed()).map((j) => (j.data as { v: string }).v).sort()).toEqual(['d', 'e', 'f']);
    } finally {
      await q.close();
    }
  });

  it('manual mode is unchanged: same id replaces, cancel removes, runDue runs self-scheduled jobs', async () => {
    const env = { ...t.app.get<Env>(ENV), JOBS_MODE: 'manual' } as Env;
    const clock = new Clock();
    const jobs = new JobsService(env, t.redis, clock);
    const runs: number[] = [];
    jobs.register('spec.m', async (data: { n: number }) => {
      runs.push(data.n);
      if (data.n === 1) await jobs.schedule('spec.m', { n: 2 }, { jobId: 'spec:m', delayMs: 1000 });
    });
    await jobs.schedule('spec.m', { n: 9 }, { jobId: 'spec:m', delayMs: 5000 });
    await jobs.schedule('spec.m', { n: 1 }, { jobId: 'spec:m' });
    expect(jobs.pending('spec.m')).toHaveLength(1);
    expect(await jobs.runDue()).toBe(1);
    expect(jobs.pending('spec.m').map((j) => j.data)).toEqual([{ n: 2 }]);
    clock.advance(1000);
    expect(await jobs.runDue()).toBe(1);
    expect(runs).toEqual([1, 2]);
    await jobs.schedule('spec.m', { n: 3 }, { jobId: 'spec:m', delayMs: 1000 });
    await jobs.cancel('spec:m');
    expect(jobs.pending('spec.m')).toEqual([]);
  });
});
