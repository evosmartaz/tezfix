import { Injectable } from '@nestjs/common';
import type { ErrorCode } from '@tezfiks/shared';
import { RedisService } from './redis.service';
import { ApiException } from '../common/http/api-exception';

export interface RateResult {
  allowed: boolean;
  count: number;
  retryAfterSec: number;
}

/** Fixed-window counters in Redis. */
@Injectable()
export class RateLimiter {
  constructor(private readonly redis: RedisService) {}

  async hit(key: string, limit: number, windowSec: number): Promise<RateResult> {
    const k = this.redis.key('rl', key);
    const res = await this.redis.client.multi().incr(k).expire(k, windowSec, 'NX').ttl(k).exec();
    const count = Number(res?.[0]?.[1] ?? 0);
    const ttl = Number(res?.[2]?.[1] ?? windowSec);
    return { allowed: count <= limit, count, retryAfterSec: ttl > 0 ? ttl : windowSec };
  }

  /** Throws `code` (default RATE_LIMITED) with { retryAfterSec } when over the limit. */
  async enforce(key: string, limit: number, windowSec: number, code: ErrorCode = 'RATE_LIMITED'): Promise<void> {
    const r = await this.hit(key, limit, windowSec);
    if (!r.allowed) throw new ApiException(code, { retryAfterSec: r.retryAfterSec });
  }

  async reset(key: string): Promise<void> {
    await this.redis.client.del(this.redis.key('rl', key));
  }
}
