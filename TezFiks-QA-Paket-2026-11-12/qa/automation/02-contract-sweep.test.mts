// AU-B01: every parameterless GET endpoint, called as every role, must either answer with a body that matches the zod
// contract or refuse with a clean 4xx. A CONTRACT_MISMATCH or a 5xx is a bug. Also AU-E08: no phone numbers in those payloads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { api, login, findPhones, PHONES } from './lib.mts';

const require = createRequire(import.meta.url);
const { collectEndpoints } = require('@tezfiks/shared');

const endpoints = (collectEndpoints(api) as Array<{ name: string; endpoint: any }>).filter(
  ({ endpoint: e }) => e.method === 'GET' && !e.params && !e.raw && e.auth === 'user' && !e.path.includes(':'),
);

const roles = [
  ['nizami', 'CUSTOMER'], ['aysel', 'CUSTOMER'], ['leyla', 'CUSTOMER'], ['demo', 'CUSTOMER'],
  ['elvin', 'PRO'], ['samir', 'PRO'], ['vuqar', 'PRO'], ['rauf', 'PRO'], ['tural', 'PRO'], ['kamran', 'PRO'],
] as const;

export const sweep: Record<string, Record<string, string>> = {};

for (const [who, app] of roles) {
  test(`AU-B01 contract sweep as ${who} (${app})`, async () => {
    const s = await login(who, app);
    const problems: string[] = [];
    const own = PHONES[who];
    sweep[who] = {};
    for (const { name, endpoint } of endpoints) {
      try {
        const out = await s.c.call(endpoint, { query: endpoint.query ? {} : undefined } as any);
        sweep[who][name] = 'ok';
        const leaked = findPhones(out).filter((p) => !p.endsWith(own.slice(-9)));
        if (leaked.length && !/chat|assignments\.get/.test(name)) problems.push(`${name}: foreign phone(s) in payload ${[...new Set(leaked)].join(',')}`);
      } catch (e: any) {
        sweep[who][name] = `${e.status} ${e.code}`;
        if (e.code === 'CONTRACT_MISMATCH') problems.push(`${name}: CONTRACT_MISMATCH ${JSON.stringify(e.details).slice(0, 400)}`);
        else if (!e.status || e.status >= 500) problems.push(`${name}: ${e.status} ${e.code} ${e.message}`);
      }
    }
    console.log(`  ${who}: ${Object.entries(sweep[who]).map(([k, v]) => `${k}=${v}`).join('  ')}`);
    assert.deepEqual(problems, []);
  });
}

test('endpoint list is not empty', () => assert.ok(endpoints.length > 10, `only ${endpoints.length} GET endpoints`));
