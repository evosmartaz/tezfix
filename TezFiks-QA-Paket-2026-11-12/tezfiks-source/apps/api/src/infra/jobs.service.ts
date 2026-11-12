import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { ENV, type Env } from '../config/env';
import { RedisService } from './redis.service';
import { Clock } from './clock';
import { newId } from './ids';

export type JobHandler = (data: any) => Promise<void> | void;

export interface ScheduleOptions {
  delayMs?: number;
  /** Absolute time (compared with Clock.now()). */
  at?: Date;
  /** Deterministic id: scheduling again with the same id replaces the pending job. */
  jobId?: string;
  attempts?: number;
}

interface ManualJob {
  id: string;
  name: string;
  data: unknown;
  runAt: number;
}

const QUEUE = 'tezfiks';

/** Separates the logical job id from the per-schedule suffix in BullMQ job ids (`<logical>--<uuid>`). */
const REF_SEP = '--';
/** A logical-id reference outlives its job by this much (cleanup of refs whose job failed for good). */
const REF_EXTRA_TTL_MS = 7 * 86_400_000;
/** Points the logical id at the new BullMQ job id and returns the previous one. KEYS: ref. ARGV: bullId, ttlMs */
const SWAP_REF = `local old = redis.call('GET', KEYS[1]) redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2]) return old`;
/** Drops the reference only while it still points at this job. KEYS: ref. ARGV: bullId */
const CLEAR_REF = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`;

/**
 * Delayed/background jobs. JOBS_MODE=bullmq uses Redis (BullMQ); JOBS_MODE=manual keeps an in-memory list
 * that tests drain with runDue() after moving the Clock. Handlers must be idempotent: they re-read state from
 * Postgres (the source of truth for every deadline) and do nothing when the state already moved on.
 *
 * Deterministic ids in BullMQ mode: every schedule gets its own BullMQ id `<logical>--<uuid>` and a Redis reference
 * `<prefix>:jobref:<logical>` names the current one. Re-scheduling swaps the reference and removes the previous job, cancel
 * removes the referenced job. (BullMQ silently ignores an add whose id already exists, and an active job cannot be removed,
 * so plain ids dropped every re-schedule made from inside the running job itself: dispatch steps, auto-complete.)
 */
@Injectable()
export class JobsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('Jobs');
  private readonly handlers = new Map<string, JobHandler>();
  private queue?: Queue;
  private worker?: Worker;
  private manual: ManualJob[] = [];
  private readonly pendingRepeats = new Map<string, { cron: string; data: object }>();
  private ready: Promise<void> = Promise.resolve();

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly redis: RedisService,
    private readonly clock: Clock,
  ) {}

  get mode(): 'bullmq' | 'manual' {
    return this.env.JOBS_MODE;
  }

  register(name: string, handler: JobHandler): void {
    if (this.handlers.has(name)) throw new Error(`Job handler already registered: ${name}`);
    this.handlers.set(name, handler);
  }

  onApplicationBootstrap(): void {
    if (this.env.JOBS_MODE !== 'bullmq') return;
    const prefix = `${this.env.REDIS_PREFIX}q`;
    this.queue = new Queue(QUEUE, { connection: this.redis.client, prefix });
    const deferred = [...this.pendingRepeats];
    this.pendingRepeats.clear();
    this.ready = Promise.all(
      deferred.map(([name, r]) =>
        this.repeat(name, r.cron, r.data).catch((err: Error) => this.log.error(`repeat ${name} failed: ${err.message}`)),
      ),
    ).then(() => undefined);
    if (this.env.ROLE !== 'api') {
      this.worker = new Worker(
        QUEUE,
        async (job) => {
          const handler = this.handlers.get(job.name);
          if (!handler) {
            this.log.warn(`No handler for job ${job.name}`);
            return;
          }
          await handler(job.data);
          // Done: the logical id no longer names a pending job (unless the handler re-scheduled it, then it names the new one).
          await this.clearRef(job.id);
        },
        { connection: this.redis.client.duplicate(), prefix, concurrency: 8 },
      );
      this.worker.on('failed', (job, err) => this.log.error(`job ${job?.name} ${job?.id} failed: ${err.message}`));
    }
  }

  private static sanitize(jobId: string): string {
    return jobId.replace(/:/g, '_');
  }

  private refKey(logicalId: string): string {
    return `${this.env.REDIS_PREFIX}:jobref:${logicalId}`;
  }

  /** Removes a BullMQ job by id when it is still waiting/delayed (an active job is locked by its worker: left alone). */
  private async removeJob(bullId: string | null | undefined): Promise<void> {
    if (!bullId || !this.queue) return;
    const job = await this.queue.getJob(bullId);
    if (!job) return;
    try {
      await job.remove();
    } catch {
      // active (locked by a worker) or finished meanwhile: handlers are idempotent
    }
  }

  private async clearRef(bullId: string | undefined): Promise<void> {
    const at = bullId?.lastIndexOf(REF_SEP) ?? -1;
    if (!bullId || at <= 0) return;
    try {
      await this.redis.client.eval(CLEAR_REF, 1, this.refKey(bullId.slice(0, at)), bullId);
    } catch (err) {
      this.log.warn(`could not clear job reference of ${bullId}: ${(err as Error).message}`);
    }
  }

  async schedule(name: string, data: object, opts: ScheduleOptions = {}): Promise<void> {
    const delay = Math.max(0, opts.at ? opts.at.getTime() - this.clock.nowMs() : (opts.delayMs ?? 0));
    const jobId = opts.jobId ? JobsService.sanitize(opts.jobId) : undefined;
    if (this.env.JOBS_MODE === 'manual') {
      if (jobId) this.manual = this.manual.filter((j) => j.id !== jobId);
      this.manual.push({ id: jobId ?? newId(), name, data, runAt: this.clock.nowMs() + delay });
      return;
    }
    if (!this.queue) throw new Error('Job queue not started');
    const options = {
      delay,
      attempts: opts.attempts ?? 3,
      backoff: { type: 'exponential' as const, delay: 1000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    };
    if (!jobId) {
      await this.queue.add(name, data, options);
      return;
    }
    // Add first, then point the logical id at the new job and drop the one it replaces: a crash in between leaves a
    // duplicate run (idempotent handlers), never a lost one.
    const bullId = `${jobId}${REF_SEP}${newId()}`;
    await this.queue.add(name, data, { ...options, jobId: bullId });
    const previous = (await this.redis.client.eval(SWAP_REF, 1, this.refKey(jobId), bullId, String(delay + REF_EXTRA_TTL_MS))) as string | null;
    if (previous && previous !== bullId) await this.removeJob(previous);
    else if (!previous) await this.removeJob(jobId); // a job queued under the plain id by an older release
  }

  async cancel(jobId: string): Promise<void> {
    const id = JobsService.sanitize(jobId);
    if (this.env.JOBS_MODE === 'manual') {
      this.manual = this.manual.filter((j) => j.id !== id);
      return;
    }
    if (!this.queue) return;
    const current = await this.redis.client.getdel(this.refKey(id));
    await this.removeJob(current);
    await this.removeJob(id); // a job queued under the plain id by an older release
  }

  /** Runs a handler immediately in-process (tests, admin "run now"). */
  async runNow(name: string, data: object): Promise<void> {
    const handler = this.handlers.get(name);
    if (!handler) throw new Error(`No handler for job ${name}`);
    await handler(data);
  }

  /** Manual mode: runs every job due at Clock.now() (including jobs scheduled by those jobs). Returns the count. */
  async runDue(): Promise<number> {
    let count = 0;
    for (let guard = 0; guard < 10_000; guard++) {
      const now = this.clock.nowMs();
      const due = this.manual.filter((j) => j.runAt <= now).sort((a, b) => a.runAt - b.runAt)[0];
      if (!due) break;
      this.manual = this.manual.filter((j) => j !== due);
      await this.runNow(due.name, due.data as object);
      count++;
    }
    return count;
  }

  /** Manual mode: pending jobs (optionally by name), for assertions. */
  pending(name?: string): Array<{ id: string; name: string; data: unknown; runAt: Date }> {
    return this.manual
      .filter((j) => !name || j.name === name)
      .map((j) => ({ id: j.id, name: j.name, data: j.data, runAt: new Date(j.runAt) }));
  }

  clearManual(): void {
    this.manual = [];
  }

  /**
   * Cron-style repeating job (Asia/Baku). No-op in manual mode. Calls made before the queue exists
   * (e.g. from a module's onModuleInit) are kept and installed when the queue starts.
   */
  async repeat(name: string, cron: string, data: object = {}): Promise<void> {
    if (this.env.JOBS_MODE !== 'bullmq') return;
    if (!this.queue) {
      this.pendingRepeats.set(name, { cron, data });
      return;
    }
    await this.queue.upsertJobScheduler(name, { pattern: cron, tz: 'Asia/Baku' }, { name, data });
  }

  /** Resolves once the schedules deferred before bootstrap are installed (bullmq mode). */
  whenReady(): Promise<void> {
    return this.ready;
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}
