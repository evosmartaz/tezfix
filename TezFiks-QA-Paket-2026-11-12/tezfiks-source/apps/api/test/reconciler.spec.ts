import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@tezfiks/shared';
import type { Env } from '../src/config/env';
import type { RedisService } from '../src/infra/redis.service';
import { ReconcilerService } from '../src/infra/reconciler.service';
import { createTestApp, type TestApp } from './helpers/app';
import { createCustomer, createSoloHandyman } from './helpers/factories';
import { createRequest, dispatch, goOnline, setSettings } from './b1/helpers';

function reconciler(redisClient: { set: (...args: unknown[]) => Promise<unknown> }, timeoutSec = 1): ReconcilerService {
  const env = { JOBS_MODE: 'bullmq', ROLE: 'all', RECONCILER_INTERVAL_SEC: 30, RECONCILER_TASK_TIMEOUT_SEC: timeoutSec } as Env;
  const redis = { key: (...p: Array<string | number>) => ['t', ...p].join(':'), client: redisClient } as unknown as RedisService;
  return new ReconcilerService(env, redis);
}

/** Collects unhandled rejections while `fn` runs (they would crash the single API process in production). */
async function unhandledDuring(fn: () => Promise<void>): Promise<unknown[]> {
  const seen: unknown[] = [];
  const onRejection = (reason: unknown) => seen.push(reason);
  process.on('unhandledRejection', onRejection);
  try {
    await fn();
    await new Promise((r) => setTimeout(r, 50));
  } finally {
    process.off('unhandledRejection', onRejection);
  }
  return seen;
}

/**
 * Hardening: the reconciler is the safety net of every timer. Its interval tick must never reject (a rejected
 * fire-and-forget promise crashes the process), one hung task must not block every other repair, and a task that is still
 * running is not started a second time.
 */
describe('ReconcilerService robustness', () => {
  it('the scheduled tick never rejects: Redis errors and failing tasks are caught and logged', async () => {
    const down = reconciler({ set: () => Promise.reject(new Error('redis down')) });
    const failing = reconciler({ set: async () => 'OK' });
    failing.register('boom', async () => {
      throw new Error('boom');
    });
    let runs = 0;
    failing.register('after', async () => {
      runs++;
    });
    const tick = (r: ReconcilerService) => (r as unknown as { tickWithLock(): Promise<void> }).tickWithLock();
    const seen = await unhandledDuring(async () => {
      await expect(tick(down)).resolves.toBeUndefined();
      await expect(tick(failing)).resolves.toBeUndefined();
      // Not stuck in "running" after a failure: the next tick runs again.
      await expect(tick(failing)).resolves.toBeUndefined();
    });
    expect(seen).toEqual([]);
    expect(runs).toBe(2);
  });

  it('a hung task times out, the tasks after it still run, and it is not started again while it is still running', async () => {
    const r = reconciler({ set: async () => 'OK' }, 1);
    let hungStarts = 0;
    let release!: () => void;
    r.register('hung', () => {
      hungStarts++;
      return new Promise<void>((resolve) => (release = resolve));
    });
    let after = 0;
    r.register('after', async () => {
      after++;
    });
    const started = Date.now();
    await r.tickAll(false);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(after).toBe(1);
    await r.tickAll(false);
    expect(hungStarts).toBe(1); // still running: skipped
    expect(after).toBe(2);
    release();
    await new Promise((res) => setTimeout(res, 10));
    await r.tickAll(false);
    expect(hungStarts).toBe(2); // finished meanwhile: runs again
  });

  it('tests keep the strict mode: tickAll() rethrows the first failure', async () => {
    const r = reconciler({ set: async () => 'OK' });
    r.register('boom', async () => {
      throw new Error('boom');
    });
    await expect(r.tickAll()).rejects.toThrow('boom');
  });
});

describe('offer decline: a failing offer:closed announcement never becomes an unhandled rejection', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
    await setSettings(t, { minCandidates: 0 });
  });

  it('declines fine while announceClosed fails', async () => {
    const c = await createCustomer(t);
    const h = await createSoloHandyman(t, { balance: 2000 });
    await goOnline(t, h.handymanId);
    const req = await createRequest(t, c);
    const offer = await t.prisma.offer.findFirstOrThrow({ where: { requestId: req.id, handymanId: h.handymanId } });
    const spy = vi.spyOn(dispatch(t), 'announceClosed').mockRejectedValueOnce(new Error('redis down'));
    try {
      const seen = await unhandledDuring(async () => {
        expect(await t.client(h.token).call(api.pro.declineOffer, { params: { id: offer.id } })).toEqual({ ok: true });
      });
      expect(seen).toEqual([]);
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
    expect((await t.prisma.offer.findUniqueOrThrow({ where: { id: offer.id } })).status).toBe('DECLINED');
  });
});
