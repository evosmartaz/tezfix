'use strict';
// Node-only helpers for the API: merges locales/<lng>/server/*.json and offers a tiny translator.
const fs = require('node:fs');
const path = require('node:path');
const { resources, LANGUAGES, DEFAULT_LANGUAGE } = require('./index.js');

function deepMerge(target, source) {
  for (const [k, v] of Object.entries(source)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      target[k] = deepMerge(target[k] && typeof target[k] === 'object' ? target[k] : {}, v);
    } else {
      target[k] = v;
    }
  }
  return target;
}

function loadServerMessages(lng) {
  const dir = path.join(__dirname, 'locales', lng, 'server');
  const merged = {};
  if (fs.existsSync(dir)) {
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
      const ns = path.basename(file, '.json');
      merged[ns] = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    }
  }
  return merged;
}

const cache = new Map();
/** All messages for a language: { common, server: { <module>: {...} } } */
function messages(lng) {
  const l = LANGUAGES.includes(lng) ? lng : DEFAULT_LANGUAGE;
  if (!cache.has(l)) cache.set(l, deepMerge({ common: resources[l].common }, { server: loadServerMessages(l) }));
  return cache.get(l);
}

function lookup(obj, key) {
  return key.split('.').reduce((o, part) => (o && typeof o === 'object' ? o[part] : undefined), obj);
}

const pluralRules = {};
function pluralSuffix(lng, count) {
  if (!pluralRules[lng]) pluralRules[lng] = new Intl.PluralRules(lng === 'az' ? 'az' : lng);
  return pluralRules[lng].select(count);
}

/**
 * Translate "common.errors.NOT_FOUND" or "server.dispatch.offerTitle".
 * Falls back to az, then to the key itself. Supports {{var}} and plural keys (_one/_few/_many/_other) via vars.count.
 */
function translate(lng, key, vars) {
  const order = [lng, DEFAULT_LANGUAGE, 'en'];
  for (const l of order) {
    const m = messages(l);
    let value;
    if (vars && typeof vars.count === 'number') {
      value = lookup(m, `${key}_${pluralSuffix(l, vars.count)}`) ?? lookup(m, `${key}_other`);
    }
    if (value === undefined) value = lookup(m, key);
    if (typeof value === 'string') {
      return value.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name) => (vars && vars[name] !== undefined ? String(vars[name]) : ''));
    }
  }
  return key;
}

function clearCache() {
  cache.clear();
}

module.exports = { messages, translate, loadServerMessages, clearCache };
