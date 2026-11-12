import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../helpers/app';
import { adminToken, createCompany } from '../helpers/factories';
import { closeAllSockets, connectSocket, emitAck, nextEvent, receives } from './helpers';

describe('company rooms of a blocked company', () => {
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
  afterEach(() => {
    closeAllSockets();
  });

  it('managers of a BLOCKED company neither auto-join nor may join its room; admins still can', async () => {
    const co = await createCompany(t, { workers: 0 });
    await t.prisma.company.update({ where: { id: co.companyId }, data: { status: 'BLOCKED' } });

    const manager = await connectSocket(t, { token: co.manager.token });
    const got = receives(manager, 'company:workers');
    t.realtime.toCompany(co.companyId, 'company:workers', { companyId: co.companyId });
    expect(await got).toBe(false);
    expect(await emitAck(manager, 'room:join', { room: 'company', id: co.companyId })).toEqual({ ok: false, error: 'FORBIDDEN' });

    const admin = await adminToken(t);
    expect(await emitAck(await connectSocket(t, { token: admin.token }), 'room:join', { room: 'company', id: co.companyId })).toEqual({ ok: true });
  });

  it('managers of a company that is not blocked (e.g. still in review) keep their room', async () => {
    const co = await createCompany(t, { workers: 0 });
    await t.prisma.company.update({ where: { id: co.companyId }, data: { status: 'PENDING_REVIEW' } });
    const manager = await connectSocket(t, { token: co.manager.token });
    const got = nextEvent(manager, 'company:workers');
    t.realtime.toCompany(co.companyId, 'company:workers', { companyId: co.companyId });
    expect(await got).toEqual({ companyId: co.companyId });
  });
});
