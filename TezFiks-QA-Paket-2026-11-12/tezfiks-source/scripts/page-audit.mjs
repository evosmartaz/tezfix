#!/usr/bin/env node
/**
 * Automatically discover every frontend page and verify that it is a real route.
 * This is static route coverage, not a browser/device screenshot or functional E2E test.
 * Run from anywhere: node scripts/page-audit.mjs
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targets = [
  { name: 'Customer (Expo)', dir: 'apps/customer/src/app', mode: 'expo' },
  { name: 'Usta / Pro (Expo)', dir: 'apps/pro/src/app', mode: 'expo' },
  { name: 'Admin + Company (Next.js)', dir: 'apps/panel/src/app', mode: 'next' },
];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const all = [];
  for (const entry of entries) {
    if (entry.isDirectory()) all.push(...await walk(path.join(dir, entry.name)));
    else if (entry.isFile()) all.push(path.join(dir, entry.name));
  }
  return all;
}

function isPage(relative, mode) {
  const name = path.basename(relative);
  if (mode === 'next') return name === 'page.tsx' || name === 'page.jsx';
  return /\.(tsx|jsx)$/.test(name) && !name.startsWith('_') && !name.startsWith('+');
}

function hasDefaultExport(source) {
  return /export\s+default\s+(?:async\s+)?(?:function|class|\(|\{|[A-Za-z_$])/.test(source) ||
    /export\s*\{[^}]*\bas\s+default\b[^}]*\}/s.test(source);
}

const failures = [];
let pageCount = 0;
for (const target of targets) {
  const folder = path.join(root, target.dir);
  let files;
  try { files = (await walk(folder)).filter(file => isPage(file, target.mode)).sort(); }
  catch (error) {
    failures.push(target.name + ': cannot read ' + target.dir + ' (' + error.message + ')');
    continue;
  }
  if (!files.length) failures.push(target.name + ': no routes discovered');
  process.stdout.write('\n' + target.name + ': ' + files.length + ' routes\n');
  for (const file of files) {
    const rel = path.relative(root, file).replaceAll(path.sep, '/');
    const source = await readFile(file, 'utf8');
    const errors = [];
    if (!source.trim()) errors.push('empty route');
    if (!hasDefaultExport(source)) errors.push('missing default export');
    if (source.includes('<<<<<<<') || source.includes('>>>>>>>')) errors.push('merge conflict marker');
    if (errors.length) failures.push(rel + ': ' + errors.join(', '));
    process.stdout.write((errors.length ? 'FAIL ' : ' OK  ') + rel + '\n');
    pageCount++;
  }
}
process.stdout.write('\nAudited ' + pageCount + ' page modules across customer, pro and web panels.\n');
if (failures.length) {
  console.error('\nRoute audit failed:\n' + failures.map(f => ' - ' + f).join('\n'));
  process.exitCode = 1;
} else {
  console.log('All discovered page modules passed static entrypoint checks.');
  console.log('Note: this does not certify rendering, UI fidelity, authentication, or navigation.');
}
