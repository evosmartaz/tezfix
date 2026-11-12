import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api } from '@tezfiks/shared';
import { createTestApp, type TestApp } from './helpers/app';
import { adminToken } from './helpers/factories';

describe('health and public config', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
  });

  it('reports database and redis status under the /tezfix/api prefix', async () => {
    const res = await t.client().call(api.health.get);
    expect(res).toMatchObject({ status: 'ok', db: true, redis: true });
    expect(t.baseUrl.endsWith('/tezfix/api')).toBe(true);
  });

  it('exposes fees and timers from platform settings', async () => {
    const cfg = await t.client().call(api.health.config);
    expect(cfg).toMatchObject({ requestFee: 1000, emergencyFeePerSlot: 500, cancelPenalty: 1500, freeCancelSec: 300, currency: 'AZN', aiEnabled: false, mapsEnabled: false });
    await t.settings.update({ requestFee: 1200 }, null);
    expect((await t.client().call(api.health.config)).requestFee).toBe(1200);
  });

  it('exposes penaltyCompensation (the provider share of the decline-on-arrival penalty) and follows admin changes', async () => {
    // t.client() validates the response against the contract.
    const cfg = await t.client().call(api.health.config);
    expect(cfg.penaltyCompensation).toBe((await t.settings.get()).penaltyCompensation);
    expect(cfg.penaltyCompensation).toBe(1000);
    const boss = await adminToken(t, { role: 'ADMIN' });
    await t.client(boss.token).call(api.admin.updateSettings, { body: { cancelPenalty: 2000, penaltyCompensation: 1400 } });
    t.settings.invalidate();
    expect(await t.client().call(api.health.config)).toMatchObject({ cancelPenalty: 2000, penaltyCompensation: 1400 });
  });

  it('renders unknown routes as a localized NOT_FOUND error body', async () => {
    const res = await fetch(`${t.baseUrl}/does-not-exist`, { headers: { 'Accept-Language': 'ru' } });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: expect.objectContaining({ code: 'NOT_FOUND', message: 'Не найдено' }) });
  });

  it('rejects protected endpoints without a token', async () => {
    const res = await fetch(`${t.baseUrl}/me`);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('UNAUTHORIZED');
  });
});
