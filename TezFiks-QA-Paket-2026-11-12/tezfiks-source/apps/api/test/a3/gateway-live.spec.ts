import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../helpers/app';
import { BAKU, createCompany, createCustomer } from '../helpers/factories';
import { TokenService } from '../../src/common/auth/token.service';
import { RealtimeGateway } from '../../src/modules/realtime/realtime.gateway';
import { RoomAccessService } from '../../src/modules/realtime/room-access.service';
import { closeAllSockets, connectSocket, createAssignment, createRequest, emitAck, nextEvent, receives, type ClientSocket } from './helpers';

const disconnectedOnce = (s: ClientSocket) => new Promise<string>((resolve) => s.once('disconnect', (reason) => resolve(reason)));

/** Review Focus #2 (privacy) for state that changes after the Socket.IO handshake. */
describe('realtime gateway: sessions and memberships after the handshake', () => {
  let t: TestApp;
  let gateway: RealtimeGateway;
  let access: RoomAccessService;
  beforeAll(async () => {
    t = await createTestApp();
    gateway = t.app.get(RealtimeGateway);
    access = t.app.get(RoomAccessService);
  });
  afterAll(async () => {
    closeAllSockets();
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
  });
  afterEach(() => {
    closeAllSockets();
  });

  describe('revoked sessions', () => {
    it('a realtime ticket whose session was revoked is refused', async () => {
      const c = await createCustomer(t);
      const session = await t.prisma.session.findFirstOrThrow({ where: { userId: c.userId } });
      const { ticket } = await t.app.get(TokenService).issueRealtimeTicket({ kind: 'user', userId: c.userId, sessionId: session.id, app: 'PANEL' });
      await t.sessions.revoke(session.id, 'logout');
      await expect(connectSocket(t, { ticket })).rejects.toThrow('UNAUTHORIZED');
    });

    it('a ticket for a blocked user is refused', async () => {
      const c = await createCustomer(t);
      const session = await t.prisma.session.findFirstOrThrow({ where: { userId: c.userId } });
      const { ticket } = await t.app.get(TokenService).issueRealtimeTicket({ kind: 'user', userId: c.userId, sessionId: session.id, app: 'PANEL' });
      await t.prisma.user.update({ where: { id: c.userId }, data: { status: 'BLOCKED' } });
      t.sessions.invalidateCache();
      await expect(connectSocket(t, { ticket })).rejects.toThrow('UNAUTHORIZED');
    });

    it('a connected socket whose session is revoked gets UNAUTHORIZED on its next event and is disconnected', async () => {
      const c = await createCustomer(t);
      const { requestId } = await createRequest(t, c);
      const s = await connectSocket(t, { token: c.token });
      expect(await emitAck(s, 'room:join', { room: 'request', id: requestId })).toEqual({ ok: true });
      const session = await t.prisma.session.findFirstOrThrow({ where: { userId: c.userId } });
      await t.sessions.revoke(session.id, 'logout');
      const gone = disconnectedOnce(s);
      expect(await emitAck(s, 'room:join', { room: 'request', id: requestId })).toEqual({ ok: false, error: 'UNAUTHORIZED' });
      expect(await gone).toBe('io server disconnect');
    });

    it('the reconciler sweep disconnects idle sockets of revoked sessions and keeps valid ones', async () => {
      const a = await createCustomer(t);
      const b = await createCustomer(t);
      const sa = await connectSocket(t, { token: a.token });
      const sb = await connectSocket(t, { token: b.token });
      const session = await t.prisma.session.findFirstOrThrow({ where: { userId: a.userId } });
      await t.sessions.revoke(session.id, 'account deleted');
      const gone = disconnectedOnce(sa);
      await t.reconciler.tickAll();
      expect(await gone).toBe('io server disconnect');
      expect(sb.connected).toBe(true);
      const got = nextEvent(sb, 'company:workers');
      t.realtime.toUser(b.userId, 'company:workers', { companyId: crypto.randomUUID() });
      await expect(got).resolves.toBeTruthy();
    });

    it('pro:location from a socket whose session was revoked is refused', async () => {
      const co = await createCompany(t, { workers: 1, workersOnline: true });
      const w = co.workers[0]!;
      const s = await connectSocket(t, { token: w.token });
      const session = await t.prisma.session.findFirstOrThrow({ where: { userId: w.userId } });
      await t.sessions.revoke(session.id, 'logout');
      expect(await emitAck(s, 'pro:location', BAKU.center)).toEqual({ ok: false, error: 'UNAUTHORIZED' });
    });
  });

  describe('company membership changes', () => {
    it('a removed manager leaves the company room (and its assignment rooms) of a live socket via refreshUser', async () => {
      const customer = await createCustomer(t);
      const co = await createCompany(t, { workers: 1 });
      const { requestId, slotId } = await createRequest(t, customer);
      const worker = co.workers[0]!;
      const assignmentId = await createAssignment(t, { requestId, slotId, handymanId: worker.handymanId, userId: co.manager.userId, companyId: co.companyId });

      const m = await connectSocket(t, { token: co.manager.token });
      const c = await connectSocket(t, { token: customer.token });
      expect(await emitAck(m, 'room:join', { room: 'assignment', id: assignmentId })).toEqual({ ok: true });
      expect(await emitAck(c, 'room:join', { room: 'assignment', id: assignmentId })).toEqual({ ok: true });
      const before = nextEvent(m, 'company:workers');
      t.realtime.toCompany(co.companyId, 'company:workers', { companyId: co.companyId });
      expect(await before).toEqual({ companyId: co.companyId });

      await t.prisma.companyMember.updateMany({ where: { companyId: co.companyId, userId: co.manager.userId }, data: { status: 'REMOVED', removedAt: t.clock.now() } });
      const res = await access.refreshUser(co.manager.userId);
      expect(res.left).toBe(2);

      const mCompany = receives(m, 'company:workers');
      t.realtime.toCompany(co.companyId, 'company:workers', { companyId: co.companyId });
      expect(await mCompany).toBe(false);
      const mAssign = receives(m, 'assignment:updated');
      const cAssign = nextEvent(c, 'assignment:updated');
      t.realtime.toAssignment(assignmentId, 'assignment:updated', { assignmentId, requestId, status: 'EN_ROUTE' });
      expect(await mAssign).toBe(false);
      expect(await cAssign).toEqual({ assignmentId, requestId, status: 'EN_ROUTE' });
      // The socket stays connected and keeps its own user room.
      expect(m.connected).toBe(true);
      const own = nextEvent(m, 'company:workers');
      t.realtime.toUser(co.manager.userId, 'company:workers', { companyId: co.companyId });
      expect(await own).toEqual({ companyId: co.companyId });
      // Re-joining is refused now.
      expect(await emitAck(m, 'room:join', { room: 'company', id: co.companyId })).toEqual({ ok: false, error: 'FORBIDDEN' });
    });

    it('a manager demoted to worker is evicted by the reconciler sweep even if no lane calls refreshUser', async () => {
      const co = await createCompany(t, { workers: 0 });
      const m = await connectSocket(t, { token: co.manager.token });
      await t.prisma.companyMember.updateMany({ where: { companyId: co.companyId, userId: co.manager.userId }, data: { role: 'WORKER' } });
      await t.reconciler.tickAll();
      const got = receives(m, 'company:workers');
      t.realtime.toCompany(co.companyId, 'company:workers', { companyId: co.companyId });
      expect(await got).toBe(false);
      expect(m.connected).toBe(true);
    });

    it('a worker promoted to manager joins the company room without reconnecting, and leaving it keeps the subscription', async () => {
      const co = await createCompany(t, { workers: 1 });
      const w = co.workers[0]!;
      const s = await connectSocket(t, { token: w.token });
      await t.prisma.companyMember.updateMany({ where: { companyId: co.companyId, userId: w.userId }, data: { role: 'MANAGER' } });
      const res = await access.refreshUser(w.userId);
      expect(res.joined).toBe(1);
      const got = nextEvent(s, 'company:workers');
      t.realtime.toCompany(co.companyId, 'company:workers', { companyId: co.companyId });
      expect(await got).toEqual({ companyId: co.companyId });
      expect(await emitAck(s, 'room:leave', { room: 'company', id: co.companyId })).toEqual({ ok: true });
      const still = nextEvent(s, 'company:workers');
      t.realtime.toCompany(co.companyId, 'company:workers', { companyId: co.companyId });
      expect(await still).toEqual({ companyId: co.companyId });
    });

    it('sweep and refreshUser leave active managers, customers and admins untouched', async () => {
      const co = await createCompany(t, { workers: 0 });
      const customer = await createCustomer(t);
      const { requestId } = await createRequest(t, customer);
      const m = await connectSocket(t, { token: co.manager.token });
      const c = await connectSocket(t, { token: customer.token });
      expect(await emitAck(c, 'room:join', { room: 'request', id: requestId })).toEqual({ ok: true });
      const res = await gateway.sweep();
      expect(res).toEqual({ disconnected: 0, left: 0, joined: 0 });
      const mGot = nextEvent(m, 'company:workers');
      const cGot = nextEvent(c, 'request:updated');
      t.realtime.toCompany(co.companyId, 'company:workers', { companyId: co.companyId });
      t.realtime.toRequest(requestId, 'request:updated', { requestId, status: 'SEARCHING' });
      expect(await mGot).toEqual({ companyId: co.companyId });
      expect(await cGot).toEqual({ requestId, status: 'SEARCHING' });
      expect(await access.refreshUser(crypto.randomUUID())).toEqual({ left: 0, joined: 0 });
    });
  });
});
