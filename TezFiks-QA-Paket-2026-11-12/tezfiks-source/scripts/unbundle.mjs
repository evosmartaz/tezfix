#!/usr/bin/env node
// Unpacks a bundle file into the repo. Format:
//   @@@FILE relative/path/from/repo/root@@@
//   ...file content...
// Every file runs until the next @@@FILE line or end of input.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'));
const bundle = process.argv[2];
if (!bundle) {
  console.error('usage: node scripts/unbundle.mjs <bundle-file>');
  process.exit(1);
}
const text = readFileSync(bundle, 'utf8').replace(/\r\n/g, '\n');
const re = /^@@@FILE (.+?)@@@\n/gm;
const marks = [...text.matchAll(re)];
if (marks.length === 0) {
  console.error('no @@@FILE markers found');
  process.exit(1);
}
for (let i = 0; i < marks.length; i++) {
  const m = marks[i];
  const rel = m[1].trim();
  const start = m.index + m[0].length;
  const end = i + 1 < marks.length ? marks[i + 1].index : text.length;
  let body = text.slice(start, end);
  if (!body.endsWith('\n')) body += '\n';
  const dest = resolve(root, rel);
  if (!dest.startsWith(root)) throw new Error('path escapes repo: ' + rel);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, body, 'utf8');
  console.log('wrote', rel, body.length);
}
