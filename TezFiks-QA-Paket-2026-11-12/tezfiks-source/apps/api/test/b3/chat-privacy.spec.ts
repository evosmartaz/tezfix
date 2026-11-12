import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, rooms } from '@tezfiks/shared';
import { createTestApp, type TestApp } from '../helpers/app';
import { BAKU, createCustomer, tokenFor } from '../helpers/factories';
import { addDevice, along, assignmentRow, companyJob, placeAt, presence, pushLog, setSettings, soloJob, toArrived } from './helpers';

describe('B3 chat and privacy: chat window, participants, no phones before unlock, trusted location pings only', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
    await setSettings(t, { minCandidates: 0 });
  });

  it('chat: locked before unlock, open after arrival, closed 2 h after the job ended', async () => {
    const job = await soloJob(t);
    const { c, h, assignmentId: id } = job;
    await addDevice(t, h.userId, 'PRO');
    const C = t.client(c.token);
    const H = t.client(h.token);
    await expect(C.call(api.chat.send, { params: { id }, body: { body: 'Salam' } })).rejects.toMatchObject({ code: 'CHAT_LOCKED', status: 403 });
    await expect(H.call(api.chat.send, { params: { id }, body: { body: 'Salam' } })).rejects.toMatchObject({ code: 'CHAT_LOCKED' });
    expect((await C.call(api.chat.list, { params: { id } })).items).toEqual([]);

    await toArrived(t, job);
    t.realtime.clearSent();
    const m1 = await C.call(api.chat.send, { params: { id }, body: { body: 'Salam! Qapı kodu 45#. Zəng edin: 050 123 45 67' } });
    expect(m1).toMatchObject({ senderSide: 'CUSTOMER', senderUserId: c.userId, senderName: 'Nizami T.', readAt: null });
    expect(t.realtime.sentTo(rooms.assignment(id), 'chat:message')).toHaveLength(1);
    expect(t.realtime.sentTo(rooms.user(h.userId), 'chat:message')).toHaveLength(1);
    expect(t.realtime.sentTo(rooms.user(c.userId), 'chat:message')).toHaveLength(0);
    // The notification and its push carry the sender's name and ids only, never the text.
    const n = await t.prisma.notification.findFirstOrThrow({ where: { userId: h.userId, type: 'CHAT_MESSAGE' } });
    expect(n.body).toContain('Nizami T.');
    expect(n.body).not.toContain('Qapı');
    expect(n.data).toMatchObject({ assignmentId: id, messageId: m1.id });
    const push = pushLog(t).sentTo(h.userId, 'CHAT_MESSAGE');
    expect(push).toHaveLength(1);
    expect(JSON.stringify(push[0]!.message)).not.toContain('Qapı');
    expect(JSON.stringify(push[0]!.message)).not.toContain('123 45 67');

    const m2 = await H.call(api.chat.send, { params: { id }, body: { body: 'Gəlirəm, 2 dəqiqəyə' } });
    expect(m2).toMatchObject({ senderSide: 'PROVIDER', senderName: 'Elvin Məmmədov' });
    const list = await C.call(api.chat.list, { params: { id } });
    expect(list.items.map((m) => m.id)).toEqual([m2.id, m1.id]);
    const page = await C.call(api.chat.list, { params: { id }, query: { limit: 1 } });
    expect(page.items.map((m) => m.id)).toEqual([m2.id]);
    const page2 = await C.call(api.chat.list, { params: { id }, query: { limit: 1, cursor: page.nextCursor! } });
    expect(page2.items.map((m) => m.id)).toEqual([m1.id]);
    expect(page2.nextCursor).toBeNull();
    // Mark read: the other side's messages only.
    await H.call(api.chat.markRead, { params: { id } });
    expect((await t.prisma.chatMessage.findUniqueOrThrow({ where: { id: m1.id } })).readAt).not.toBeNull();
    expect((await t.prisma.chatMessage.findUniqueOrThrow({ where: { id: m2.id } })).readAt).toBeNull();

    // Strangers: NOT_FOUND.
    const stranger = await createCustomer(t);
    await expect(t.client(stranger.token).call(api.chat.list, { params: { id } })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(t.client(stranger.token).call(api.chat.send, { params: { id }, body: { body: 'x' } })).rejects.toMatchObject({ code: 'NOT_FOUND' });

    // Complete (cash), then the chat stays open for chatOpenAfterTerminalMin = 120 minutes (the Clock keeps ticking in real
    // time, so "just before" leaves a 2 s margin).
    await H.call(api.pro.enterPrice, { params: { id }, body: { labor: 1000, materials: 0 } });
    await C.call(api.assignments.confirmPrice, { params: { id }, body: { method: 'CASH' } });
    const ended = (await assignmentRow(t, id)).endedAt!;
    t.clock.set(new Date(ended.getTime() + 120 * 60_000 - 2_000));
    const C2 = t.client(await tokenFor(t, c.userId, 'CUSTOMER'));
    await C2.call(api.chat.send, { params: { id }, body: { body: 'Təşəkkürlər!' } });
    expect((await C2.call(api.assignments.get, { params: { id } })).providerPhone).toBe(h.phone);
    t.clock.set(new Date(ended.getTime() + 120 * 60_000 + 1_000));
    const C3 = t.client(await tokenFor(t, c.userId, 'CUSTOMER'));
    await expect(C3.call(api.chat.send, { params: { id }, body: { body: 'Hələ?' } })).rejects.toMatchObject({ code: 'CHAT_LOCKED' });
    const after = await C3.call(api.assignments.get, { params: { id } });
    expect(after).toMatchObject({ providerPhone: null, chatEnabled: false, contactUnlocked: true });
    // History stays readable.
    expect((await C3.call(api.chat.list, { params: { id } })).items).toHaveLength(3);
  });

  it('company chat: the customer talks to the managers; the assigned worker is not a chat participant (spec 4.4: workers contact the manager)', async () => {
    const job = await companyJob(t);
    const { c, co, worker, assignmentId: id } = job;
    await t.client(worker.token).call(api.pro.enRoute, { params: { id }, body: { location: BAKU.narimanov } });
    await t.client(worker.token).call(api.pro.arrived, { params: { id } });
    t.realtime.clearSent();
    await t.client(c.token).call(api.chat.send, { params: { id }, body: { body: 'Salam' } });
    expect(t.realtime.sentTo(rooms.user(co.manager.userId), 'chat:message')).toHaveLength(1);
    // The worker sits in the assignment room for tracking, so company chat never goes there, nor to the worker's own room or push.
    expect(t.realtime.sentTo(rooms.user(worker.userId), 'chat:message')).toHaveLength(0);
    expect(t.realtime.sentTo(rooms.assignment(id), 'chat:message')).toHaveLength(0);
    expect(await t.prisma.notification.count({ where: { userId: worker.userId, type: 'CHAT_MESSAGE' } })).toBe(0);
    expect(await t.prisma.notification.count({ where: { userId: co.manager.userId, type: 'CHAT_MESSAGE' } })).toBe(1);
    const fromManager = await t.client(co.manager.token).call(api.chat.send, { params: { id }, body: { body: 'Ustamız yerindədir' } });
    expect(fromManager.senderSide).toBe('PROVIDER');
    expect(t.realtime.sentTo(rooms.user(c.userId), 'chat:message')).toHaveLength(1);
    expect(t.realtime.sentTo(rooms.user(worker.userId), 'chat:message')).toHaveLength(0);
    // The assigned worker can neither read, send nor mark read; the worker-limited view says chat is off.
    const W = t.client(worker.token);
    await expect(W.call(api.chat.list, { params: { id } })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    await expect(W.call(api.chat.send, { params: { id }, body: { body: 'Qapıdayam' } })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(W.call(api.chat.markRead, { params: { id } })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await t.prisma.chatMessage.count({ where: { assignmentId: id } })).toBe(2);
    expect(await W.call(api.pro.assignment, { params: { id } })).toMatchObject({ view: 'WORKER_LIMITED', contactUnlocked: true, chatEnabled: false });
    const workerList = await W.call(api.pro.assignments, { query: { scope: 'active' } });
    expect(workerList.items[0]).toMatchObject({ id, chatEnabled: false });
    // Managers keep the chat in the full view.
    expect(await t.client(co.manager.token).call(api.company.assignment, { params: { companyId: co.companyId, id } })).toMatchObject({
      view: 'FULL',
      chatEnabled: true,
    });
    // The other worker is not a participant either.
    await expect(t.client(co.workers[1]!.token).call(api.chat.list, { params: { id } })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('no phone anywhere before the unlock: customer/pro views, socket payloads, notifications and pushes', async () => {
    const job = await soloJob(t);
    const { c, h, assignmentId: id } = job;
    await addDevice(t, c.userId, 'CUSTOMER');
    await addDevice(t, h.userId, 'PRO');
    await placeAt(t, h.handymanId, BAKU.ahmadli); // the server-side position is the route origin (DEMO_MODE=false)
    await t.client(h.token).call(api.pro.enRoute, { params: { id }, body: { location: BAKU.ahmadli } });
    const p = along(BAKU.ahmadli, BAKU.center, 0.3);
    await t.client(h.token).call(api.pro.location, { body: { lat: p.lat, lng: p.lng } });
    const cv = await t.client(c.token).call(api.assignments.get, { params: { id } });
    const pv = await t.client(h.token).call(api.pro.assignment, { params: { id } });
    const req = await t.client(c.token).call(api.requests.get, { params: { id: job.requestId } });
    const digits = (x: string) => x.replace(/\D/g, '').slice(-7);
    for (const payload of [cv, pv, req, ...t.realtime.sent.map((s) => s.payload)]) {
      const text = JSON.stringify(payload);
      expect(text).not.toContain(digits(h.phone));
      expect(text).not.toContain(digits(c.phone));
    }
    for (const n of await t.prisma.notification.findMany()) {
      expect(JSON.stringify(n)).not.toContain(digits(h.phone));
      expect(JSON.stringify(n)).not.toContain(digits(c.phone));
    }
    for (const s of pushLog(t).sent) {
      expect(JSON.stringify(s.message)).not.toContain(digits(h.phone));
      expect(JSON.stringify(s.message)).not.toContain(digits(c.phone));
    }
    expect(cv.providerPhone).toBeNull();
    expect(pv.customerPhone).toBeNull();
  });

  it('location pings: ignored when the pro is not APPROVED or the user is not ACTIVE; a foreign assignment id is never trusted', async () => {
    const job = await soloJob(t);
    const { h, assignmentId: id } = job;
    await placeAt(t, h.handymanId, BAKU.ahmadli); // the server-side position is the route origin (DEMO_MODE=false)
    await t.client(h.token).call(api.pro.enRoute, { params: { id }, body: { location: BAKU.ahmadli } });
    const start = await assignmentRow(t, id);

    // Another pro sends pings naming our assignment: the presence layer does not verify it, nothing moves.
    const other = await soloJob(t);
    const fake = along(BAKU.ahmadli, BAKU.center, 0.99);
    await presence(t).updateLocation(other.h.handymanId, { lat: fake.lat, lng: fake.lng, assignmentId: id });
    expect(await assignmentRow(t, id)).toMatchObject({ lastLat: start.lastLat, etaSec: start.etaSec, contactUnlockedAt: null });

    // Our own pro with its own assignment id (socket path): accepted.
    const p1 = along(BAKU.ahmadli, BAKU.center, 0.5);
    t.clock.advance(5_000);
    await presence(t).updateLocation(h.handymanId, { lat: p1.lat, lng: p1.lng, assignmentId: id });
    expect((await assignmentRow(t, id)).lastLat).toBe(p1.lat);

    // Profile blocked (status only, e.g. mid-review): pings are ignored.
    await t.prisma.handymanProfile.update({ where: { id: h.handymanId }, data: { status: 'PENDING_REVIEW' } });
    t.clock.advance(5_000);
    await presence(t).updateLocation(h.handymanId, { lat: fake.lat, lng: fake.lng, assignmentId: id });
    expect((await assignmentRow(t, id)).lastLat).toBe(p1.lat);
    expect((await assignmentRow(t, id)).contactUnlockedAt).toBeNull();
    // User not active: ignored too.
    await t.prisma.handymanProfile.update({ where: { id: h.handymanId }, data: { status: 'APPROVED' } });
    await t.prisma.user.update({ where: { id: h.userId }, data: { status: 'BLOCKED' } });
    t.clock.advance(5_000);
    await presence(t).updateLocation(h.handymanId, { lat: fake.lat, lng: fake.lng });
    expect((await assignmentRow(t, id)).lastLat).toBe(p1.lat);
    await t.prisma.user.update({ where: { id: h.userId }, data: { status: 'ACTIVE' } });
    // Active again: the close ping unlocks the contact.
    t.clock.advance(5_000);
    await presence(t).updateLocation(h.handymanId, { lat: fake.lat, lng: fake.lng });
    expect((await assignmentRow(t, id)).contactUnlockedAt).not.toBeNull();
    // An out-of-order (older) ping is ignored.
    await presence(t).updateLocation(h.handymanId, { lat: p1.lat, lng: p1.lng, at: new Date(t.clock.nowMs() - 60_000) });
    expect((await assignmentRow(t, id)).lastLat).toBe(fake.lat);
  });

  it('off-route pings re-route at most every 120 s', async () => {
    const job = await soloJob(t);
    const { h, assignmentId: id } = job;
    await placeAt(t, h.handymanId, BAKU.ahmadli); // the server-side position is the route origin (DEMO_MODE=false)
    await t.client(h.token).call(api.pro.enRoute, { params: { id }, body: { location: BAKU.ahmadli } });
    const r0 = await assignmentRow(t, id);
    // ~1 km north of the straight line: off route.
    const mid = along(BAKU.ahmadli, BAKU.center, 0.5);
    const off = { lat: mid.lat + 0.01, lng: mid.lng };
    t.clock.advance(60_000);
    await presence(t).updateLocation(h.handymanId, off);
    expect((await assignmentRow(t, id)).routeComputedAt).toEqual(r0.routeComputedAt); // too soon
    t.clock.advance(60_000);
    await presence(t).updateLocation(h.handymanId, off);
    const r2 = await assignmentRow(t, id);
    expect(r2.routeComputedAt!.getTime()).toBeGreaterThan(r0.routeComputedAt!.getTime());
    expect(r2.routePolyline).not.toBe(r0.routePolyline);
    expect(r2.etaSec).toBe(r2.routeDurationSec);
  });
});
