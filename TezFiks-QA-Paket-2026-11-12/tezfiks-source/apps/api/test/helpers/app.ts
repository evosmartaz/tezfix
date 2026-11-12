import 'reflect-metadata';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createApiClient, type ApiClient } from '@tezfiks/shared';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { loadEnv } from '../../src/config/env';
import { PrismaService } from '../../src/infra/prisma.service';
import { RedisService } from '../../src/infra/redis.service';
import { Clock } from '../../src/infra/clock';
import { JobsService } from '../../src/infra/jobs.service';
import { ReconcilerService } from '../../src/infra/reconciler.service';
import { RealtimeService } from '../../src/infra/realtime.service';
import { SettingsService } from '../../src/common/settings/settings.service';
import { SessionsService } from '../../src/common/auth/sessions.service';
import { LedgerService } from '../../src/modules/ledger/ledger.service';
import { resetDb } from './db';

export interface TestApp {
  app: INestApplication;
  /** e.g. http://127.0.0.1:54321/tezfix/api */
  baseUrl: string;
  /** http://127.0.0.1:54321 */
  origin: string;
  prisma: PrismaService;
  redis: RedisService;
  clock: Clock;
  jobs: JobsService;
  reconciler: ReconcilerService;
  realtime: RealtimeService;
  settings: SettingsService;
  sessions: SessionsService;
  ledger: LedgerService;
  /** Typed contract client; validates every response against the contract. */
  client(accessToken?: string | null, locale?: 'az' | 'ru' | 'en'): ApiClient;
  /** Truncates all tables, re-seeds base data, flushes Redis, resets the clock and manual jobs. */
  reset(): Promise<void>;
  close(): Promise<void>;
}

export async function createTestApp(customize?: (b: TestingModuleBuilder) => TestingModuleBuilder): Promise<TestApp> {
  const env = loadEnv();
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (customize) builder = customize(builder);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true, bodyParser: false, logger: ['error', 'warn'] });
  configureApp(app, env);
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as { port: number };
  const origin = `http://127.0.0.1:${address.port}`;
  const baseUrl = `${origin}/${env.API_PREFIX}`;
  const t: TestApp = {
    app,
    baseUrl,
    origin,
    prisma: app.get(PrismaService),
    redis: app.get(RedisService),
    clock: app.get(Clock),
    jobs: app.get(JobsService),
    reconciler: app.get(ReconcilerService),
    realtime: app.get(RealtimeService),
    settings: app.get(SettingsService),
    sessions: app.get(SessionsService),
    ledger: app.get(LedgerService),
    client(accessToken, locale = 'az') {
      return createApiClient({
        baseUrl,
        getAccessToken: () => accessToken ?? null,
        getLocale: () => locale,
        validateResponses: true,
      });
    },
    async reset() {
      await resetDb(t.prisma);
      await t.redis.client.flushdb();
      t.clock.reset();
      t.jobs.clearManual();
      t.realtime.clearSent();
      t.settings.invalidate();
      t.sessions.invalidateCache();
      t.ledger.resetCache();
    },
    async close() {
      await app.close();
    },
  };
  return t;
}
