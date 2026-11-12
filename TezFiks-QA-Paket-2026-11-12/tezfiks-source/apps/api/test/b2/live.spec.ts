import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api } from '@tezfiks/shared';
import { createTestApp, type TestApp } from '../helpers/app';
import { adminToken, createCompany, createCustomer, createSoloHandyman, createUser, tokenFor } from '../helpers/factories';
import { closeAllSockets, connectSocket, disconnected, onboardCompany, proUser, receives, sleep, type ClientSocket } from './helpers';

/**
 * Membership and block changes take effect on already connected sockets at once (not only on the next
 * realtime.sweep reconciler tick, which these tests never run).
 */
describe('B2 live effects on connected sockets', () => {
  let t: TestApp;
  let admin: { adminId: string; token: string };
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    closeAllSockets();
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
    admin = await adminToken(t);
  });
  afterEach(() => {
    closeAllSockets();
  });

  /** True when the socket receives an event sent to the company room. */
  async function inCompanyRoom(s: ClientSocket, companyId: string): Promise<boolean> {
    const got = receives(s, 'company:workers', 400);
    t.realtime.toCompany(companyId, 'company:workers', { companyId });
    return got;
  }

  it('blockUser drops every live socket of the user right away', async () => {
    const h = await createSoloHandyman(t, { balance: 5000 });
    const customerToken = await tokenFor(t, h.userId, 'CUSTOMER');
    const pro = await connectSocket(t, h.token);
    const cust = await connectSocket(t, customerToken);
    const other = await createCustomer(t);
    const bystander = await connectSocket(t, other.token);
    const goneA = disconnected(pro);
    const goneB = disconnected(cust);
    await t.client(admin.token).call(api.admin.blockUser, { params: { id: h.userId }, body: { reason: 'Fırıldaqçılıq' } });
    expect(await goneA).toBe('io server disconnect');
    expect(await goneB).toBe('io server disconnect');
    expect(bystander.connected).toBe(true);
    await expect(connectSocket(t, h.token)).rejects.toThrow('UNAUTHORIZED');
  });

  it('blockHandyman drops the PRO sockets (session revoked) but keeps the customer-app socket', async () => {
    const h = await createSoloHandyman(t, { balance: 5000 });
    const customerToken = await tokenFor(t, h.userId, 'CUSTOMER');
    const pro = await connectSocket(t, h.token);
    const cust = await connectSocket(t, customerToken);
    const gone = disconnected(pro);
    await t.client(admin.token).call(api.admin.blockHandyman, { params: { id: h.handymanId }, body: { reason: 'Saxta sənəd' } });
    expect(await gone).toBe('io server disconnect');
    await sleep(100);
    expect(cust.connected).toBe(true);
    await expect(connectSocket(t, h.token)).rejects.toThrow('UNAUTHORIZED');
    expect(await t.prisma.session.count({ where: { userId: h.userId, app: 'PRO', revokedAt: null } })).toBe(0);
    expect(await t.prisma.session.count({ where: { userId: h.userId, app: 'CUSTOMER', revokedAt: null } })).toBe(1);
  });

  it('blockCompany drops the PRO and PANEL sockets of its members (customer-app sockets stay)', async () => {
    const c = await createCompany(t, { workers: 1, balance: 5000 });
    const panelToken = await tokenFor(t, c.manager.userId, 'PANEL');
    const customerToken = await tokenFor(t, c.manager.userId, 'CUSTOMER');
    const worker = await connectSocket(t, c.workers[0]!.token);
    const panel = await connectSocket(t, panelToken);
    const managerCustomer = await connectSocket(t, customerToken);
    expect(await inCompanyRoom(panel, c.companyId)).toBe(true);
    const goneW = disconnected(worker);
    const goneP = disconnected(panel);
    await t.client(admin.token).call(api.admin.blockCompany, { params: { id: c.companyId }, body: { reason: 'Şikayətlər' } });
    expect(await goneW).toBe('io server disconnect');
    expect(await goneP).toBe('io server disconnect');
    await sleep(100);
    expect(managerCustomer.connected).toBe(true);
  });

  it('a removed manager leaves the company room at once', async () => {
    const c = await createCompany(t, { workers: 0 });
    const second = await createUser(t, { firstName: 'Leyla', lastName: 'Əhmədova' });
    await t.prisma.companyMember.create({ data: { companyId: c.companyId, userId: second.userId, role: 'MANAGER' } });
    const s = await connectSocket(t, await tokenFor(t, second.userId, 'PANEL'));
    expect(await inCompanyRoom(s, c.companyId)).toBe(true);
    await t.client(c.manager.token).call(api.company.removeMember, { params: { companyId: c.companyId, userId: second.userId } });
    expect(await inCompanyRoom(s, c.companyId)).toBe(false);
    expect(s.connected).toBe(true);
  });

  it('demotion leaves and promotion joins the company room without reconnecting', async () => {
    const c = await createCompany(t, { workers: 1 });
    const w = c.workers[0]!;
    const ws = await connectSocket(t, w.token);
    const ms = await connectSocket(t, c.manager.token);
    expect(await inCompanyRoom(ws, c.companyId)).toBe(false);
    await t.client(c.manager.token).call(api.company.updateMember, { params: { companyId: c.companyId, userId: w.userId }, body: { role: 'MANAGER' } });
    expect(await inCompanyRoom(ws, c.companyId)).toBe(true);
    await t.client(w.token).call(api.company.updateMember, { params: { companyId: c.companyId, userId: c.manager.userId }, body: { role: 'WORKER' } });
    expect(await inCompanyRoom(ms, c.companyId)).toBe(false);
    expect(await inCompanyRoom(ws, c.companyId)).toBe(true);
  });

  it('accepting a MANAGER invite and registering a company join the company rooms live', async () => {
    const c = await createCompany(t, { workers: 0 });
    const inv = await t.client(c.manager.token).call(api.company.createInvite, { params: { companyId: c.companyId }, body: { role: 'MANAGER' } });
    const u = await proUser(t);
    const s = await connectSocket(t, u.token);
    expect(await inCompanyRoom(s, c.companyId)).toBe(false);
    await t.client(u.token).call(api.invites.accept, { params: { token: inv.token }, body: {} });
    expect(await inCompanyRoom(s, c.companyId)).toBe(true);

    const own = await onboardCompany(t, u, { name: 'Öz Şirkətim' });
    expect(await inCompanyRoom(s, own.id)).toBe(true);
  });
});
