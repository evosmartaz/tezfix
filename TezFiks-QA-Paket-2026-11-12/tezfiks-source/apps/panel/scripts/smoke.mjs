#!/usr/bin/env node
// Smoke test of the production build: starts `next start` on port 3100 and checks the public pages and the auth redirect.
// Usage: npm run build -w @tezfiks/panel && npm run smoke -w @tezfiks/panel
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.SMOKE_PORT ?? 3100);
const base = `http://127.0.0.1:${port}`;
const nextBin = join(appDir, 'node_modules', '.bin', process.platform === 'win32' ? 'next.cmd' : 'next');
const rootNextBin = join(
  appDir,
  '..',
  '..',
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'next.cmd' : 'next',
);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function exists(p) {
  try {
    await import('node:fs').then((fs) => fs.promises.access(p));
    return true;
  } catch {
    return false;
  }
}

const bin = (await exists(nextBin)) ? nextBin : rootNextBin;
const child = spawn(bin, ['start', '-p', String(port), '-H', '127.0.0.1'], {
  cwd: appDir,
  env: { ...process.env, NODE_ENV: 'production' },
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: process.platform === 'win32',
});
let output = '';
child.stdout.on('data', (d) => (output += d));
child.stderr.on('data', (d) => (output += d));

function stop() {
  if (child.exitCode !== null) return;
  if (process.platform === 'win32')
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
}

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
}

let failed = false;
try {
  const deadline = Date.now() + 90_000;
  let res = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`next start exited with ${child.exitCode}\n${output}`);
    try {
      res = await fetch(`${base}/tezfix/admin/login`, { redirect: 'manual' });
      break;
    } catch {
      await sleep(500);
    }
  }
  if (!res) throw new Error(`server did not start within 90 s\n${output}`);

  const html = await res.text();
  check('GET /tezfix/admin/login -> 200', res.status === 200, `status ${res.status}`);
  check('admin login renders the form', html.includes('type="password"') && html.includes('TezFiks'));

  const company = await fetch(`${base}/tezfix/company/login`, { redirect: 'manual' });
  check('GET /tezfix/company/login -> 200', company.status === 200, `status ${company.status}`);

  const guarded = await fetch(`${base}/tezfix/admin/orders`, { redirect: 'manual' });
  const location = guarded.headers.get('location') ?? '';
  check(
    'GET /tezfix/admin/orders without session redirects to login',
    guarded.status >= 300 &&
      guarded.status < 400 &&
      location.includes('/tezfix/admin/login?next=%2Fadmin%2Forders'),
    `${guarded.status} ${location}`,
  );

  const ticket = await fetch(`${base}/tezfix/bff/realtime-ticket`, { method: 'POST', redirect: 'manual' });
  check(
    'POST /tezfix/bff/realtime-ticket without session -> 401',
    ticket.status === 401,
    `status ${ticket.status}`,
  );

  const ru = await fetch(`${base}/tezfix/admin/login`, { headers: { cookie: 'locale=ru' } });
  check('locale cookie switches the language (ru)', (await ru.text()).includes('Войти'));
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  failed = true;
} finally {
  stop();
}

const bad = checks.filter((c) => !c.ok);
if (failed || bad.length) {
  console.error(`smoke: ${bad.length} check(s) failed`);
  process.exit(1);
}
console.log(`smoke: all ${checks.length} checks passed`);
process.exit(0);
