import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { ENV, type Env } from '../config/env';

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;
  readonly prefix: string;

  constructor(@Inject(ENV) env: Env) {
    this.client = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: true });
    this.prefix = env.REDIS_PREFIX;
  }

  /** Namespaced key: key('pres', '7', cell) -> "tz:pres:7:<cell>" */
  key(...parts: Array<string | number>): string {
    return [this.prefix, ...parts].join(':');
  }

  async onModuleDestroy(): Promise<void> {
    this.client.disconnect();
  }
}
