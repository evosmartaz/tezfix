import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, collectEndpoints } from '@tezfiks/shared';
import { createTestApp, type TestApp } from './helpers/app';
import { REGISTERED_ENDPOINTS } from '../src/common/http/route.decorator';

/**
 * Every endpoint of the shared contract must be implemented by exactly one controller method.
 * This test is expected to fail until all API lanes are finished; it lists what is still missing.
 */
describe('contract coverage', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });

  it('implements every contract endpoint', () => {
    const missing = collectEndpoints(api)
      .filter(({ endpoint }) => !REGISTERED_ENDPOINTS.has(endpoint))
      .map(({ name, endpoint }) => `${name}: ${endpoint.method} ${endpoint.path}`);
    expect(missing).toEqual([]);
  });
});
