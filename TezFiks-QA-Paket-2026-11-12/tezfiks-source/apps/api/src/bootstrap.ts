import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import type { NextFunction, Request, Response } from 'express';
import { Logger } from '@nestjs/common';
import type { Env } from './config/env';

/** BigInt values that slip into JSON are rendered as numbers. */
(BigInt.prototype as unknown as { toJSON: () => number }).toJSON = function (this: bigint) {
  return Number(this);
};

/** Shared HTTP setup for main.ts and the e2e test harness. */
export function configureApp(app: INestApplication, env: Env): void {
  const express = app as NestExpressApplication;
  express.set('trust proxy', env.TRUST_PROXY === 'true' ? true : env.TRUST_PROXY === 'false' ? false : env.TRUST_PROXY);
  express.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.enableCors({
    origin: env.CORS_ORIGINS.length ? env.CORS_ORIGINS : env.NODE_ENV !== 'production',
    credentials: false,
    exposedHeaders: ['Idempotent-Replayed'],
  });
  express.useBodyParser('json', { limit: '1mb' });
  express.useBodyParser('urlencoded', { limit: '100kb', extended: false });
  app.setGlobalPrefix(env.API_PREFIX);
  if (env.NODE_ENV !== 'test') {
    const log = new Logger('HTTP');
    app.use((req: Request, res: Response, next: NextFunction) => {
      const started = Date.now();
      res.on('finish', () => {
        if (req.originalUrl.endsWith('/health')) return;
        log.log(`${req.method} ${req.originalUrl.split('?')[0]} ${res.statusCode} ${Date.now() - started}ms`);
      });
      next();
    });
  }
}
