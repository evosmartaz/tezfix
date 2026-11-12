import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { loadEnv } from './config/env';

async function main(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
    bodyParser: false,
    logger: env.LOG_LEVEL === 'debug' ? ['log', 'error', 'warn', 'debug', 'verbose'] : ['log', 'error', 'warn'],
  });
  configureApp(app, env);
  app.enableShutdownHooks();
  await app.listen(env.PORT, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`TezFiks API listening on :${env.PORT}/${env.API_PREFIX} (role=${env.ROLE}, demo=${env.DEMO_MODE})`);
}

void main();
