/**
 * Demo seed CLI (plan lane B6, docs/demo.md).
 *
 *   npm run seed:demo -w @tezfiks/api          (tsx, development)
 *   node dist/prisma/seed/demo.js              (production image, compiled by `tsc -p tsconfig.build.json`)
 *
 * Boots a Nest application context with the real services (JOBS_MODE=manual: the seed drives timers itself), seeds the demo
 * data (DemoSeedService) and prints the demo logins. Requires DEMO_MODE=true (or --force). A finished seed is a no-op.
 *
 * tsx (esbuild) does not emit decorator metadata, which Nest's dependency injection needs. Under tsx this script therefore
 * compiles the API with tsc into node_modules/.cache/tezfiks-seed-demo and runs the compiled copy of itself with node.
 */
import 'reflect-metadata';
import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/infra/prisma.service';
import { DemoSeedService } from '../../src/modules/demo/demo-seed.service';
import { seedCategories, seedPlatformAccounts } from './base';

const COMPILED_FLAG = 'TEZFIKS_SEED_COMPILED';

function hasDecoratorMetadata(): boolean {
  const meta = (Reflect as unknown as { getMetadata?: (k: string, t: object) => unknown }).getMetadata?.('design:paramtypes', DemoSeedService);
  return Array.isArray(meta) && meta.length > 0;
}

/** Under tsx: compile with tsc and run the compiled seed (same arguments and environment). Returns the exit code. */
function runCompiled(): number {
  const apiDir = path.resolve(__dirname, '..', '..');
  const outDir = path.join(apiDir, 'node_modules', '.cache', 'tezfiks-seed-demo');
  // eslint-disable-next-line no-console
  console.log('Compiling the API for the demo seed (tsx cannot emit decorator metadata)...');
  const tsc = require.resolve('typescript/bin/tsc', { paths: [apiDir] });
  const build = spawnSync(process.execPath, [tsc, '-p', 'tsconfig.build.json', '--outDir', outDir], { cwd: apiDir, stdio: 'inherit' });
  const script = path.join(outDir, 'prisma', 'seed', 'demo.js');
  if (build.status !== 0) {
    // tsc still emits on type errors (noEmitOnError is off): a type error elsewhere in the tree does not block the seed.
    // eslint-disable-next-line no-console
    console.warn(`tsc exited with ${build.status}; running the emitted JavaScript anyway.`);
  }
  if (!existsSync(script)) {
    // eslint-disable-next-line no-console
    console.error(`Compiled seed not found at ${script}`);
    return 1;
  }
  const run = spawnSync(process.execPath, [script, ...process.argv.slice(2)], {
    cwd: apiDir,
    stdio: 'inherit',
    env: { ...process.env, [COMPILED_FLAG]: '1' },
  });
  return run.status ?? 1;
}

function printLogins(logins: Array<{ phone: string; name: string; role: string; app: string }>): void {
  const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length));
  const bypassPhones = (process.env.OTP_BYPASS_PHONES ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const bypassReady = !!process.env.OTP_BYPASS_CODE && logins.every((l) => bypassPhones.includes(l.phone));
  const lines = [
    '',
    '================ TezFiks demo logins ================',
    `${pad('Phone', 16)}${pad('App', 22)}${pad('Name', 30)}Role`,
    ...logins.map((l) => `${pad(l.phone, 16)}${pad(l.app, 22)}${pad(l.name, 30)}${l.role}`),
    '',
    'Logging in without WhatsApp: start the API with ONE of these.',
    `  OTP_BYPASS_PHONES=${logins.map((l) => l.phone).join(',')}`,
    '  OTP_BYPASS_CODE=123456          (any environment: these phones always accept 123456)',
    '  OTP_DEV_ECHO=true               (not in production: the code comes back as devCode in the OTP response)',
    '  With OTP_CHANNEL=console (default) the code of every OTP is also printed in the API log.',
    bypassReady
      ? '  -> OTP bypass is already configured for all demo phones in this environment.'
      : '  -> OTP bypass is not configured for all demo phones in this environment.',
    'Admin panel: the admin from ADMIN_BOOTSTRAP_EMAIL / ADMIN_BOOTSTRAP_PASSWORD (base seed).',
    'Bots: admin panel > Demo > spawn bots (the API needs DEMO_MODE=true). See docs/demo.md.',
    '=====================================================',
  ];
  // eslint-disable-next-line no-console
  console.log(lines.join('\n'));
}

async function main(): Promise<number> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  const force = process.argv.includes('--force');
  const demo = ['true', '1', 'yes'].includes((process.env.DEMO_MODE ?? '').toLowerCase());
  if (!demo && !force) {
    // eslint-disable-next-line no-console
    console.error('The demo seed adds demo users, jobs and money to this database. Set DEMO_MODE=true (or pass --force).');
    return 2;
  }
  if (!hasDecoratorMetadata()) {
    if (process.env[COMPILED_FLAG]) throw new Error('Decorator metadata is missing even in the compiled seed (check emitDecoratorMetadata).');
    return runCompiled();
  }
  // The seed plays the history with the Clock and runs due jobs itself: no BullMQ queue, no reconciler timer.
  process.env.JOBS_MODE = 'manual';
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const prisma = app.get(PrismaService);
    // The base seed normally ran already (`npm run seed`); categories are only created when missing, so admin edits stay.
    if ((await prisma.category.count()) === 0) await seedCategories(prisma as never);
    await seedPlatformAccounts(prisma as never);
    // eslint-disable-next-line no-console
    const result = await app.get(DemoSeedService).run({ log: (line) => console.log(line) });
    // eslint-disable-next-line no-console
    console.log(result.skipped ? 'Demo seed: already done (no changes).' : 'Demo seed: complete.');
    printLogins(result.logins);
  } finally {
    await app.close();
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
