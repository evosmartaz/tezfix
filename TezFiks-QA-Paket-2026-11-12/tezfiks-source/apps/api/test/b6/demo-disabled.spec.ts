import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api } from '@tezfiks/shared';
import { createTestApp, type TestApp } from '../helpers/app';
import { BAKU, adminToken, categoryId, createSoloHandyman } from '../helpers/factories';
import { simulator } from './helpers';

/** Every demo endpoint answers DEMO_DISABLED (403) unless the API runs with DEMO_MODE=true; the simulator does nothing. */
describe('demo endpoints without DEMO_MODE', () => {
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

  it('runs with DEMO_MODE=false in this app', () => {
    expect(t.settings.demoMode).toBe(false);
  });

  it('answers DEMO_DISABLED on all five endpoints', async () => {
    const { token } = await adminToken(t);
    const c = t.client(token);
    const disabled = { code: 'DEMO_DISABLED', status: 403 };
    await expect(c.call(api.admin.demoState, {})).rejects.toMatchObject(disabled);
    await expect(c.call(api.admin.demoSpawnBots, { body: { count: 2, radiusKm: 3 } })).rejects.toMatchObject(disabled);
    await expect(c.call(api.admin.demoClearBots, {})).rejects.toMatchObject(disabled);
    await expect(c.call(api.admin.demoConfig, { body: { acceptDelaySec: 5 } })).rejects.toMatchObject(disabled);
    await expect(
      c.call(api.admin.demoCreateRequest, { body: { categoryId: await categoryId(t, 'plumbing'), lat: BAKU.center.lat, lng: BAKU.center.lng } }),
    ).rejects.toMatchObject(disabled);
    expect(await t.prisma.handymanProfile.count({ where: { isBot: true } })).toBe(0);
    expect(await t.prisma.serviceRequest.count()).toBe(0);
  });

  it('still requires an admin before anything else', async () => {
    const h = await createSoloHandyman(t);
    await expect(t.client(h.token).call(api.admin.demoState, {})).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    await expect(t.client(null).call(api.admin.demoState, {})).rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401 });
  });

  it('never ticks the simulator and never arms it', async () => {
    const report = await simulator(t).tick();
    expect(report.ran).toBe(false);
    await t.reconciler.tickAll();
    expect(t.jobs.pending('demo.tick')).toHaveLength(0);
  });
});
