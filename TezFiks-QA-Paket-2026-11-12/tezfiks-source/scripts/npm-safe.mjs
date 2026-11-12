#!/usr/bin/env node
// Serializes npm invocations across parallel agents working in the same checkout.
// Usage: node scripts/npm-safe.mjs install -w @tezfiks/api some-package@1.2.3
import { mkdirSync, rmSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const lock = join(root, '.npm-lock');
const STALE_MS = 10 * 60 * 1000;
const started = Date.now();

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

for (;;) {
  try {
    mkdirSync(lock);
    break;
  } catch {
    try {
      if (Date.now() - statSync(lock).mtimeMs > STALE_MS) rmSync(lock, { recursive: true, force: true });
    } catch {}
    if (Date.now() - started > 30 * 60 * 1000) {
      console.error('npm-safe: gave up waiting for the npm lock after 30 minutes');
      process.exit(1);
    }
    sleep(2000);
  }
}

let code = 1;
try {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const res = spawnSync(npm, process.argv.slice(2), { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  code = res.status ?? 1;
} finally {
  rmSync(lock, { recursive: true, force: true });
}
process.exit(code);
