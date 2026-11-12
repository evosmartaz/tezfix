import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ENV, type Env } from '../config/env';
import { RedisService } from './redis.service';

type Task = () => Promise<void>;

class TaskTimeout extends Error {}

/**
 * Safety net for timers: every RECONCILER_INTERVAL_SEC each registered task repairs overdue state
 * (expired offers, closed free-cancel windows, stuck searches...). Tests call tickAll() directly.
 *
 * The interval tick never rejects (a rejected fire-and-forget promise would crash the single API process): Redis errors and
 * task failures are logged. A task running longer than RECONCILER_TASK_TIMEOUT_SEC is abandoned for that tick so the other
 * repairs still run, and it is not started again until its previous run settles.
 */
@Injectable()
export class ReconcilerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('Reconciler');
  private readonly tasks = new Map<string, Task>();
  /** Tasks whose last run has not settled yet (timed out but still running). */
  private readonly inFlight = new Set<string>();
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly redis: RedisService,
  ) {}

  register(name: string, task: Task): void {
    if (this.tasks.has(name)) throw new Error(`Reconciler task already registered: ${name}`);
    this.tasks.set(name, task);
  }

  onApplicationBootstrap(): void {
    if (this.env.JOBS_MODE === 'manual' || this.env.ROLE === 'api') return;
    this.timer = setInterval(() => void this.tickWithLock(), this.env.RECONCILER_INTERVAL_SEC * 1000);
    this.timer.unref();
  }

  /** The interval tick: one process at a time (Redis lock), never rejects. */
  private async tickWithLock(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const lockKey = this.redis.key('lock', 'reconciler');
      const ok = await this.redis.client.set(lockKey, '1', 'PX', this.env.RECONCILER_INTERVAL_SEC * 1000, 'NX');
      if (!ok) return;
      await this.tickAll(false);
    } catch (err) {
      this.log.error(`tick failed: ${(err as Error).message}`, (err as Error).stack);
    } finally {
      this.running = false;
    }
  }

  private timeoutMs(): number {
    return Math.max(1, this.env.RECONCILER_TASK_TIMEOUT_SEC ?? 120) * 1000;
  }

  /** Runs one task, giving up waiting after the timeout (the task keeps running; inFlight blocks a second start). */
  private async runTask(name: string, task: Task): Promise<void> {
    this.inFlight.add(name);
    const run = Promise.resolve()
      .then(task)
      .finally(() => this.inFlight.delete(name));
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new TaskTimeout(`timed out after ${this.timeoutMs()} ms`)), this.timeoutMs());
      timer.unref();
    });
    try {
      await Promise.race([run, timeout]);
    } catch (err) {
      // An abandoned run that fails later is still logged (and never an unhandled rejection).
      if (err instanceof TaskTimeout) run.catch((late: Error) => this.log.error(`task ${name} failed after its timeout: ${late.message}`));
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Runs every task once. With throwOnError (tests) the first failure is rethrown. */
  async tickAll(throwOnError = true): Promise<void> {
    for (const [name, task] of this.tasks) {
      if (this.inFlight.has(name)) {
        this.log.warn(`task ${name} is still running from an earlier tick: skipped`);
        continue;
      }
      try {
        await this.runTask(name, task);
      } catch (err) {
        this.log.error(`task ${name} failed: ${(err as Error).message}`, (err as Error).stack);
        if (throwOnError) throw err;
      }
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
