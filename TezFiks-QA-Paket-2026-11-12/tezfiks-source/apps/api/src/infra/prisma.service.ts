import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from '../generated/prisma/client';
import { ENV, type Env } from '../config/env';

/** Prisma client (driver adapter: node-postgres). Inject this, or receive a `Tx` inside $transaction callbacks. */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(ENV) env: Env) {
    super({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL, max: 20 }) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

export type Tx = Prisma.TransactionClient;
/** Either the root client or an interactive-transaction client. */
export type Db = PrismaService | Tx;

export function isRootClient(db: Db): db is PrismaService {
  return typeof (db as PrismaService).$transaction === 'function';
}

/** Runs `fn` in the given transaction, or opens a new one on the root client. */
export async function inTx<T>(db: Db, fn: (tx: Tx) => Promise<T>, opts?: { timeoutMs?: number }): Promise<T> {
  if (!isRootClient(db)) return fn(db);
  return db.$transaction((tx) => fn(tx), { timeout: opts?.timeoutMs ?? 20_000, maxWait: 10_000 });
}
