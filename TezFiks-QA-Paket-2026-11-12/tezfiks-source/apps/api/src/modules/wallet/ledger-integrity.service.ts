import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { BAKU_OFFSET_MINUTES, bakuDayKey } from '@tezfiks/shared';
import { LedgerService } from '../ledger/ledger.service';
import { ReconcilerService } from '../../infra/reconciler.service';
import { RedisService } from '../../infra/redis.service';
import { Clock } from '../../infra/clock';

export type IntegrityMismatch = Awaited<ReturnType<LedgerService['verifyIntegrity']>>[number];

/**
 * Nightly ledger check (spec section 7): recomputes cached balances from entries and holds and logs mismatches.
 * Registered as the reconciler task `ledger.integrity`; it runs at most once per Baku day (Redis marker), from 03:00 Baku.
 */
@Injectable()
export class LedgerIntegrityService implements OnModuleInit {
  private readonly log = new Logger('LedgerIntegrity');
  /** Baku-local hour from which the daily check may run. */
  static readonly RUN_FROM_HOUR = 3;

  constructor(
    private readonly ledger: LedgerService,
    private readonly reconciler: ReconcilerService,
    private readonly redis: RedisService,
    private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    this.reconciler.register('ledger.integrity', async () => {
      await this.runDaily();
    });
  }

  /** Runs the check once per Baku day. Returns the mismatches, or null when it already ran today / too early. */
  async runDaily(): Promise<IntegrityMismatch[] | null> {
    const now = this.clock.now();
    const bakuHour = new Date(now.getTime() + BAKU_OFFSET_MINUTES * 60_000).getUTCHours();
    if (bakuHour < LedgerIntegrityService.RUN_FROM_HOUR) return null;
    const marker = this.redis.key('ledger-integrity', bakuDayKey(now));
    const first = await this.redis.client.set(marker, '1', 'EX', 2 * 24 * 3600, 'NX');
    if (!first) return null;
    return this.checkNow();
  }

  /** Runs the check immediately and logs every mismatch and a non-zero global sum. */
  async checkNow(): Promise<IntegrityMismatch[]> {
    const [mismatches, sum] = await Promise.all([this.ledger.verifyIntegrity(), this.ledger.globalSum()]);
    for (const m of mismatches) {
      this.log.error(
        `ledger mismatch account=${m.accountId} posted=${m.posted} computedPosted=${m.computedPosted} held=${m.held} computedHeld=${m.computedHeld}`,
      );
    }
    if (sum !== 0) this.log.error(`ledger global sum is ${sum}, expected 0`);
    return mismatches;
  }
}
