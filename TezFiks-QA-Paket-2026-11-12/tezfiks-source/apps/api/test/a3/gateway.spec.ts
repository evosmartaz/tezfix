import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { latLngToCell } from 'h3-js';
import { rooms } from '@tezfiks/shared';
import { createTestApp, type TestApp } from '../helpers/app';
import { adminToken, BAKU, createCompany, createCustomer, createSoloHandyman, createUser, tokenFor } from '../helpers/factories';
import { TokenService } from '../../src/common/auth/token.service';
import { DomainEvents } from '../../src/infra/events';
import { PresenceService, type LocationEvent } from '../../src/modules/realtime/presence.service';
import { closeAllSockets, connectSocket, createAssignment, createRequest, emitAck, nextEvent, receives } from './helpers';

const sampleNotification = (id = '0199a000-0000-7000-8000-000000000001') => ({
  id,
  type: 'GENERIC' as const,
  title: 'Salam',
  body: 'Test',
  data: {},
  readAt: null,
  createdAt: new Date().toISOString(),
});

describe('realtime gateway (Socket.IO)', () => {
  let t: TestApp;
  let presence: PresenceService;
  beforeAll(async () => {
    t = await createTestApp();
    presence = t.app.get(PresenceService);
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

  describe('handshake auth', () => {
    it('connects with an access token and receives events sent to user:<id>', async () => {
      const c = await createCustomer(t);
      const socket = await connectSocket(t, { token: c.token });
      const got = nextEvent(socket, 'notification:new');
      t.realtime.toUser(c.userId, 'notification:new', sampleNotification());
      expect(await got).toMatchObject({ title: 'Salam', type: 'GENERIC' });
      expect(t.realtime.sentTo(rooms.user(c.userId), 'notification:new')).toHaveLength(1);
    });

    it('does not deliver another user’s events', async () => {
      const a = await createCustomer(t);
      const b = await createCustomer(t);
      const socket = await connectSocket(t, { token: a.token });
      const got = receives(socket, 'notification:new');
      t.realtime.toUser(b.userId, 'notification:new', sampleNotification());
      expect(await got).toBe(false);
    });

    it('rejects a bad token, a missing token and a garbage ticket with UNAUTHORIZED', async () => {
      await expect(connectSocket(t, { token: 'not-a-jwt' })).rejects.toThrow('UNAUTHORIZED');
      await expect(connectSocket(t, {})).rejects.toThrow('UNAUTHORIZED');
      await expect(connectSocket(t, { ticket: 'nope' })).rejects.toThrow('UNAUTHORIZED');
    });

    it('rejects a token whose session was revoked or whose user is blocked', async () => {
      const c = await createCustomer(t);
      const session = await t.prisma.session.findFirstOrThrow({ where: { userId: c.userId } });
      await t.sessions.revoke(session.id, 'test');
      await expect(connectSocket(t, { token: c.token })).rejects.toThrow('UNAUTHORIZED');

      const u = await createUser(t);
      const token = await tokenFor(t, u.userId, 'CUSTOMER');
      await t.prisma.user.update({ where: { id: u.userId }, data: { status: 'BLOCKED' } });
      t.sessions.invalidateCache();
      await expect(connectSocket(t, { token })).rejects.toThrow('UNAUTHORIZED');
    });

    it('disconnects live sockets of a user when user.blocked is emitted', async () => {
      const c = await createCustomer(t);
      const other = await createCustomer(t);
      const s = await connectSocket(t, { token: c.token });
      const o = await connectSocket(t, { token: other.token });
      const disconnected = new Promise<string>((resolve) => s.once('disconnect', (reason) => resolve(reason)));
      await t.app.get(DomainEvents).emit('user.blocked', { userId: c.userId, reason: 'fraud' });
      expect(await disconnected).toBe('io server disconnect');
      expect(o.connected).toBe(true);
    });

    it('rejects an expired access token (clock moved past the TTL)', async () => {
      const c = await createCustomer(t);
      t.clock.advance(16 * 60_000);
      await expect(connectSocket(t, { token: c.token })).rejects.toThrow('UNAUTHORIZED');
    });

    it('accepts a realtime ticket exactly once', async () => {
      const c = await createCustomer(t);
      const tokens = t.app.get(TokenService);
      const session = await t.prisma.session.findFirstOrThrow({ where: { userId: c.userId } });
      const { ticket } = await tokens.issueRealtimeTicket({ kind: 'user', userId: c.userId, sessionId: session.id, app: 'PANEL' });
      const socket = await connectSocket(t, { ticket });
      const got = nextEvent(socket, 'notification:new');
      t.realtime.toUser(c.userId, 'notification:new', sampleNotification());
      await expect(got).resolves.toBeTruthy();
      await expect(connectSocket(t, { ticket })).rejects.toThrow('UNAUTHORIZED');
    });

    it('admins join the admins room automatically (token or ticket)', async () => {
      const admin = await adminToken(t);
      const socket = await connectSocket(t, { token: admin.token });
      const got = nextEvent(socket, 'admin:event');
      t.realtime.toAdmins('admin:event', { type: 'request.created', entityId: null });
      expect(await got).toEqual({ type: 'request.created', entityId: null });

      const session = await t.prisma.session.findFirstOrThrow({ where: { adminId: admin.adminId } });
      const { ticket } = await t.app.get(TokenService).issueRealtimeTicket({ kind: 'admin', adminId: admin.adminId, sessionId: session.id, role: 'ADMIN' });
      const viaTicket = await connectSocket(t, { ticket });
      const got2 = nextEvent(viaTicket, 'admin:event');
      t.realtime.toAdmins('admin:event', { type: 'x', entityId: 'y' });
      expect(await got2).toEqual({ type: 'x', entityId: 'y' });
    });

    it('non-admin users do not receive admin events', async () => {
      const c = await createCustomer(t);
      const socket = await connectSocket(t, { token: c.token });
      const got = receives(socket, 'admin:event');
      t.realtime.toAdmins('admin:event', { type: 'x', entityId: null });
      expect(await got).toBe(false);
    });

    it('active managers join their company room on connect; workers and removed managers do not', async () => {
      const co = await createCompany(t, { workers: 1 });
      const manager = await connectSocket(t, { token: co.manager.token });
      const worker = await connectSocket(t, { token: co.workers[0]!.token });
      const mGot = nextEvent(manager, 'company:workers');
      const wGot = receives(worker, 'company:workers');
      t.realtime.toCompany(co.companyId, 'company:workers', { companyId: co.companyId });
      expect(await mGot).toEqual({ companyId: co.companyId });
      expect(await wGot).toBe(false);

      // A removed manager no longer joins on (re)connect.
      const co2 = await createCompany(t, { workers: 0 });
      await t.prisma.companyMember.updateMany({ where: { companyId: co2.companyId, userId: co2.manager.userId }, data: { status: 'REMOVED' } });
      const removed = await connectSocket(t, { token: co2.manager.token });
      const rGot = receives(removed, 'company:workers');
      t.realtime.toCompany(co2.companyId, 'company:workers', { companyId: co2.companyId });
      expect(await rGot).toBe(false);
    });
  });

  describe('room:join / room:leave authorization', () => {
    it('request room: its customer and admins may join, strangers may not', async () => {
      const customer = await createCustomer(t);
      const stranger = await createCustomer(t);
      const admin = await adminToken(t);
      const { requestId } = await createRequest(t, customer);

      const cs = await connectSocket(t, { token: customer.token });
      const ss = await connectSocket(t, { token: stranger.token });
      const as = await connectSocket(t, { token: admin.token });
      expect(await emitAck(cs, 'room:join', { room: 'request', id: requestId })).toEqual({ ok: true });
      expect(await emitAck(ss, 'room:join', { room: 'request', id: requestId })).toEqual({ ok: false, error: 'FORBIDDEN' });
      expect(await emitAck(as, 'room:join', { room: 'request', id: requestId })).toEqual({ ok: true });

      const cGot = nextEvent(cs, 'request:updated');
      const aGot = nextEvent(as, 'request:updated');
      const sGot = receives(ss, 'request:updated');
      t.realtime.toRequest(requestId, 'request:updated', { requestId, status: 'SEARCHING' });
      expect(await cGot).toEqual({ requestId, status: 'SEARCHING' });
      expect(await aGot).toEqual({ requestId, status: 'SEARCHING' });
      expect(await sGot).toBe(false);

      // Leaving stops delivery.
      expect(await emitAck(cs, 'room:leave', { room: 'request', id: requestId })).toEqual({ ok: true });
      const after = receives(cs, 'request:updated');
      t.realtime.toRequest(requestId, 'request:updated', { requestId, status: 'CANCELLED' });
      expect(await after).toBe(false);
    });

    it('unknown request ids and malformed payloads are refused', async () => {
      const customer = await createCustomer(t);
      const cs = await connectSocket(t, { token: customer.token });
      expect(await emitAck(cs, 'room:join', { room: 'request', id: crypto.randomUUID() })).toEqual({ ok: false, error: 'FORBIDDEN' });
      expect(await emitAck(cs, 'room:join', { room: 'user', id: customer.userId })).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
      expect(await emitAck(cs, 'room:join', { room: 'request', id: 'not-a-uuid' })).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    });

    it('assignment room: customer, assigned handyman, company managers and admins; not other workers, other companies or strangers', async () => {
      const customer = await createCustomer(t);
      const co = await createCompany(t, { workers: 2 });
      const otherCo = await createCompany(t, { workers: 0 });
      const solo = await createSoloHandyman(t);
      const stranger = await createCustomer(t);
      const admin = await adminToken(t);
      const { requestId, slotId } = await createRequest(t, customer);
      const worker = co.workers[0]!;
      const assignmentId = await createAssignment(t, { requestId, slotId, handymanId: worker.handymanId, userId: co.manager.userId, companyId: co.companyId });

      const join = async (token: string) => emitAck(await connectSocket(t, { token }), 'room:join', { room: 'assignment', id: assignmentId });
      expect(await join(customer.token)).toEqual({ ok: true });
      expect(await join(worker.token)).toEqual({ ok: true });
      expect(await join(co.manager.token)).toEqual({ ok: true });
      expect(await join(admin.token)).toEqual({ ok: true });
      expect(await join(co.workers[1]!.token)).toEqual({ ok: false, error: 'FORBIDDEN' });
      expect(await join(otherCo.manager.token)).toEqual({ ok: false, error: 'FORBIDDEN' });
      expect(await join(solo.token)).toEqual({ ok: false, error: 'FORBIDDEN' });
      expect(await join(stranger.token)).toEqual({ ok: false, error: 'FORBIDDEN' });

      // Live delivery to a joined handyman.
      const ws = await connectSocket(t, { token: worker.token });
      await emitAck(ws, 'room:join', { room: 'assignment', id: assignmentId });
      const got = nextEvent(ws, 'assignment:updated');
      t.realtime.toAssignment(assignmentId, 'assignment:updated', { assignmentId, requestId, status: 'EN_ROUTE' });
      expect(await got).toEqual({ assignmentId, requestId, status: 'EN_ROUTE' });
    });

    it('a solo handyman may join the room of their own assignment', async () => {
      const customer = await createCustomer(t);
      const solo = await createSoloHandyman(t);
      const { requestId, slotId } = await createRequest(t, customer);
      const assignmentId = await createAssignment(t, { requestId, slotId, handymanId: solo.handymanId, userId: solo.userId });
      const s = await connectSocket(t, { token: solo.token });
      expect(await emitAck(s, 'room:join', { room: 'assignment', id: assignmentId })).toEqual({ ok: true });
    });

    it('company room: active manager or admin only', async () => {
      const co = await createCompany(t, { workers: 1 });
      const other = await createCompany(t, { workers: 0 });
      const admin = await adminToken(t);
      const join = async (token: string) => emitAck(await connectSocket(t, { token }), 'room:join', { room: 'company', id: co.companyId });
      expect(await join(co.manager.token)).toEqual({ ok: true });
      expect(await join(admin.token)).toEqual({ ok: true });
      expect(await join(co.workers[0]!.token)).toEqual({ ok: false, error: 'FORBIDDEN' });
      expect(await join(other.manager.token)).toEqual({ ok: false, error: 'FORBIDDEN' });
    });

    it('leaving the auto-joined company room keeps the manager subscribed', async () => {
      const co = await createCompany(t, { workers: 0 });
      const s = await connectSocket(t, { token: co.manager.token });
      expect(await emitAck(s, 'room:leave', { room: 'company', id: co.companyId })).toEqual({ ok: true });
      const got = nextEvent(s, 'company:workers');
      t.realtime.toCompany(co.companyId, 'company:workers', { companyId: co.companyId });
      expect(await got).toEqual({ companyId: co.companyId });
    });
  });

  describe('pro:location and pro:heartbeat', () => {
    it('updates presence and runs registered location handlers', async () => {
      const pro = await createSoloHandyman(t, { online: true });
      await presence.setOnline(pro.handymanId, BAKU.center);
      const events: LocationEvent[] = [];
      const off = presence.onLocation(async (e) => {
        events.push(e);
      });
      try {
        const s = await connectSocket(t, { token: pro.token });
        const ack = await emitAck(s, 'pro:location', { lat: BAKU.narimanov.lat, lng: BAKU.narimanov.lng, heading: 90, speed: 8.5, accuracy: 12 });
        expect(ack).toEqual({ ok: true });
        const state = await presence.get(pro.handymanId);
        expect(state).toMatchObject({ lat: BAKU.narimanov.lat, lng: BAKU.narimanov.lng, cell7: latLngToCell(BAKU.narimanov.lat, BAKU.narimanov.lng, 7), online: true, heading: 90 });
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ handymanId: pro.handymanId, userId: pro.userId, companyId: null, lat: BAKU.narimanov.lat, heading: 90, speed: 8.5, accuracy: 12, assignmentId: null });
        const cands = await presence.candidatesInCells([latLngToCell(BAKU.narimanov.lat, BAKU.narimanov.lng, 7)], 90);
        expect(cands.map((c) => c.handymanId)).toEqual([pro.handymanId]);

        const assignmentId = crypto.randomUUID();
        await emitAck(s, 'pro:location', { lat: BAKU.center.lat, lng: BAKU.center.lng, assignmentId });
        expect(events[1]).toMatchObject({ assignmentId, heading: null });
      } finally {
        off();
      }
    });

    it('company workers can report location too (companyId carried)', async () => {
      const co = await createCompany(t, { workers: 1, workersOnline: true });
      const w = co.workers[0]!;
      const s = await connectSocket(t, { token: w.token });
      expect(await emitAck(s, 'pro:location', BAKU.center)).toEqual({ ok: true });
      expect(await presence.get(w.handymanId)).toMatchObject({ companyId: co.companyId, userId: w.userId, online: true });
    });

    it('refuses callers without a handyman profile and invalid payloads', async () => {
      const c = await createCustomer(t);
      const s = await connectSocket(t, { token: c.token });
      expect(await emitAck(s, 'pro:location', BAKU.center)).toEqual({ ok: false, error: 'FORBIDDEN' });
      expect(await emitAck(s, 'pro:heartbeat', {})).toEqual({ ok: false, error: 'FORBIDDEN' });
      const admin = await adminToken(t);
      const as = await connectSocket(t, { token: admin.token });
      expect(await emitAck(as, 'pro:location', BAKU.center)).toEqual({ ok: false, error: 'FORBIDDEN' });

      const pro = await createSoloHandyman(t);
      const ps = await connectSocket(t, { token: pro.token });
      expect(await emitAck(ps, 'pro:location', { lat: 200, lng: 49.8 })).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
      expect(await emitAck(ps, 'pro:location', { lat: 'x' })).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    });

    it('heartbeat refreshes last-seen so the handyman stays fresh', async () => {
      const pro = await createSoloHandyman(t, { online: true });
      await presence.setOnline(pro.handymanId, BAKU.center);
      const cell = latLngToCell(BAKU.center.lat, BAKU.center.lng, 7);
      t.clock.advance(80_000);
      const s = await connectSocket(t, { token: pro.token });
      expect(await emitAck(s, 'pro:heartbeat', {})).toEqual({ ok: true });
      t.clock.advance(80_000);
      // 160 s since setOnline, 80 s since the heartbeat: still fresh for a 90 s window.
      expect((await presence.candidatesInCells([cell], 90)).map((c) => c.handymanId)).toEqual([pro.handymanId]);
    });
  });
});
