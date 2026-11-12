'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const LANGS = ['az', 'ru', 'en'];
const root = path.join(__dirname, '..', 'locales');

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

function files(lng) {
  const base = path.join(root, lng);
  const list = [];
  for (const f of fs.readdirSync(base)) {
    if (f.endsWith('.json')) list.push(f);
  }
  const serverDir = path.join(base, 'server');
  if (fs.existsSync(serverDir)) for (const f of fs.readdirSync(serverDir)) if (f.endsWith('.json')) list.push(`server/${f}`);
  return list.sort();
}

function pluralBase(key) {
  return key.replace(/_(zero|one|two|few|many|other)$/, '');
}

test('all languages have the same files', () => {
  assert.deepStrictEqual(files('ru'), files('az'));
  assert.deepStrictEqual(files('en'), files('az'));
});

test('all languages have the same keys (plural forms compared by base key)', () => {
  for (const file of files('az')) {
    const sets = LANGS.map((l) => {
      const json = JSON.parse(fs.readFileSync(path.join(root, l, file), 'utf8'));
      return new Set(Object.keys(flatten(json)).map(pluralBase));
    });
    for (let i = 1; i < sets.length; i++) {
      const missing = [...sets[0]].filter((k) => !sets[i].has(k));
      const extra = [...sets[i]].filter((k) => !sets[0].has(k));
      assert.deepStrictEqual({ file, lang: LANGS[i], missing, extra }, { file, lang: LANGS[i], missing: [], extra: [] });
    }
  }
});

test('russian plural keys carry one/few/many/other', () => {
  for (const file of files('ru')) {
    const flat = flatten(JSON.parse(fs.readFileSync(path.join(root, 'ru', file), 'utf8')));
    const bases = new Set(Object.keys(flat).filter((k) => /_(one|few|many|other)$/.test(k)).map(pluralBase));
    for (const b of bases) for (const s of ['one', 'few', 'many', 'other']) assert.ok(`${b}_${s}` in flat, `${file}: ${b}_${s}`);
  }
});

test('no empty strings', () => {
  for (const l of LANGS) for (const file of files(l)) {
    const flat = flatten(JSON.parse(fs.readFileSync(path.join(root, l, file), 'utf8')));
    for (const [k, v] of Object.entries(flat)) assert.ok(typeof v === 'string' && v.trim().length > 0, `${l}/${file}: ${k}`);
  }
});

test('server translate interpolates and pluralizes', () => {
  const { translate } = require('../server.js');
  assert.strictEqual(translate('az', 'common.errors.NOT_FOUND'), 'Tapılmadı');
  assert.strictEqual(translate('xx', 'common.errors.NOT_FOUND'), 'Tapılmadı');
  assert.strictEqual(translate('ru', 'common.units.minutes', { count: 3 }), '3 минуты');
  assert.strictEqual(translate('ru', 'common.units.minutes', { count: 5 }), '5 минут');
  assert.strictEqual(translate('en', 'common.units.minutes', { count: 1 }), '1 min');
});
