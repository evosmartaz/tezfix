import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, rooms } from '@tezfiks/shared';
import { createTestApp, type TestApp } from '../helpers/app';
import { BAKU, createSoloHandyman } from '../helpers/factories';
import { I18nService } from '../../src/common/i18n/i18n.service';
import {
  addDevice,
  assignmentRow,
  bal,
  blocks,
  companyJob,
  expectLedgerSound,
  goOnline,
  placeAt,
  pushLog,
  setSettings,
  soloJob,
  toArrived,
  toPriceProposed,
} from './helpers';

const digits = (x: string) => x.replace(/\D/g, '').slice(-7);
const reasonText = (t: TestApp, locale: 'az' | 'en', key: string) => t.app.get(I18nService).t(locale, `server.jobs.cancelReason.${key}`);

describe('B3 hardening: phone-free lists, block reconciler, chat rate limit, reassign reasons, unlock at en-route', () => {
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

  // ------------------------------------------------------------- lists privacy

  it('pro lists never carry the customer phone, also after the contact unlock (the single view does)', async () => {
    const job = await soloJob(t);
    const { c, h, assignmentId: id } = job;
    await toArrived(t, job);
    const H = t.client(h.token);
    // The single-assignment view has the phone inside the window...
    expect((await H.call(api.pro.assignment, { params: { id } })).customerPhone).toBe(c.phone);
    // ...lists never do.
    for (const query of [{}, { scope: 'active' as const }]) {
      const list = await H.call(api.pro.assignments, { query });
      expect(list.items.map((x) => x.id)).toEqual([id]);
      expect(list.items[0]!).toMatchObject({ contactUnlocked: true, chatEnabled: true, customerPhone: null });
      expect(JSON.stringify(list)).not.toContain(digits(c.phone));
    }
    // The customer's own request list stays free of the provider phone too.
    const reqs = await t.client(c.token).call(api.requests.list, {});
    expect(JSON.stringify(reqs)).not.toContain(digits(h.phone));
    // After completion (inside the 2 h chat window) the lists still carry no phone.
    await H.call(api.pro.enterPrice, { params: { id }, body: { labor: 1000, materials: 0 } });
    await t.client(c.token).call(api.assignments.confirmPrice, { params: { id }, body: { method: 'CASH' } });
    expect((await H.call(api.pro.assignment, { params: { id } })).customerPhone).toBe(c.phone);
    const history = await H.call(api.pro.assignments, { query: { scope: 'history' } });
    expect(history.items).toHaveLength(1);
    expect(history.items[0]!.customerPhone).toBeNull();
    expect(JSON.stringify(history)).not.toContain(digits(c.phone));
  });

  it('company lists (manager) and the worker list never carry the customer phone after the unlock', async () => {
    const job = await companyJob(t);
    const { c, co, worker, assignmentId: id } = job;
    await t.client(worker.token).call(api.pro.enRoute, { params: { id }, body: { location: BAKU.narimanov } });
    await t.client(worker.token).call(api.pro.arrived, { params: { id } });
    const M = t.client(co.manager.token);
    // The manager's single view has the phone inside the window.
    expect((await M.call(api.company.assignment, { params: { companyId: co.companyId, id } })).customerPhone).toBe(c.phone);
    for (const query of [{}, { scope: 'active' as const }]) {
      const list = await M.call(api.company.assignments, { params: { companyId: co.companyId }, query });
      expect(list.items.map((x) => x.id)).toEqual([id]);
      expect(list.items[0]!).toMatchObject({ contactUnlocked: true, customerPhone: null });
      expect(JSON.stringify(list)).not.toContain(digits(c.phone));
    }
    const wl = await t.client(worker.token).call(api.pro.assignments, {});
    expect(wl.items).toHaveLength(1);
    expect(wl.items[0]!.customerPhone).toBeNull();
    expect(JSON.stringify(wl)).not.toContain(digits(c.phone));
  });

  // ---------------------------------------------------------- block reconciler

  it('reconciler: a handyman BLOCKED without the event (lost listener) still has its running job cancelled and re-dispatched', async () => {
    // A job of another (also blocked) pro with a proposed price must stay untouched.
    const done = await soloJob(t);
    await toPriceProposed(t, done);
    const job = await soloJob(t, { proBalance: 2000 });
    await t.prisma.user.update({ where: { id: job.c.userId }, data: { locale: 'en' } });
    await t.client(job.h.token).call(api.pro.enRoute, { params: { id: job.assignmentId }, body: { location: BAKU.narimanov } });
    const other = await createSoloHandyman(t, { balance: 2000 });
    await goOnline(t, other.handymanId, BAKU.center);

    // B2 committed the block but the post-commit event never reached B3.
    await t.prisma.handymanProfile.update({ where: { id: job.h.handymanId }, data: { status: 'BLOCKED' } });
    await t.prisma.handymanProfile.update({ where: { id: done.h.handymanId }, data: { status: 'BLOCKED' } });
    expect((await assignmentRow(t, job.assignmentId)).status).toBe('EN_ROUTE');
    await t.reconciler.tickAll();

    const a = await assignmentRow(t, job.assignmentId);
    expect(a).toMatchObject({ status: 'CANCELLED_FREE', cancelledBy: 'ADMIN' });
    // The reason is stored in the customer's language.
    expect(a.cancelReason).toBe(reasonText(t, 'en', 'providerBlocked'));
    expect(a.cancelReason).not.toBe(reasonText(t, 'az', 'providerBlocked'));
    const r = await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: job.requestId }, include: { slots: true } });
    expect(r).toMatchObject({ status: 'SEARCHING', isSearching: true });
    expect(r.slots[0]).toMatchObject({ status: 'OPEN', currentAssignmentId: null });
    expect(await t.prisma.offer.count({ where: { requestId: job.requestId, handymanId: other.handymanId, status: 'SENT' } })).toBe(1);
    expect(await bal(t, job.h.walletAccountId!)).toMatchObject({ posted: 2000, held: 0 });
    expect((await assignmentRow(t, done.assignmentId)).status).toBe('PRICE_PROPOSED');
    // Idempotent: a second sweep changes nothing.
    expect(await blocks(t).repair()).toEqual([]);
    expect(await t.prisma.notification.count({ where: { userId: job.c.userId, type: 'ASSIGNMENT_CANCELLED' } })).toBe(1);
    await expectLedgerSound(t);
  });

  it('reconciler: BLOCKED user accounts and BLOCKED companies are swept as well', async () => {
    const solo = await soloJob(t);
    const co = await companyJob(t, { balance: 5000 });
    await t.prisma.user.update({ where: { id: solo.h.userId }, data: { status: 'BLOCKED' } });
    await t.prisma.company.update({ where: { id: co.co.companyId }, data: { status: 'BLOCKED' } });
    const cancelled = await blocks(t).repair();
    expect(cancelled.sort()).toEqual([solo.assignmentId, co.assignmentId].sort());
    expect(await assignmentRow(t, solo.assignmentId)).toMatchObject({ status: 'CANCELLED_FREE', cancelledBy: 'ADMIN' });
    const ca = await assignmentRow(t, co.assignmentId);
    expect(ca).toMatchObject({ status: 'CANCELLED_FREE', cancelledBy: 'ADMIN' });
    expect(ca.cancelReason).toBe(reasonText(t, 'az', 'companyBlocked'));
    expect(await bal(t, co.co.walletAccountId)).toEqual({ posted: 5000, held: 0, available: 5000 });
    expect(await bal(t, solo.h.walletAccountId!)).toEqual({ posted: 2000, held: 0, available: 2000 });
    await expectLedgerSound(t);
  });

  // ------------------------------------------------------------------- chat

  it('chat: 30 messages per minute per user, then RATE_LIMITED (429); a blocked user cannot send (USER_BLOCKED)', async () => {
    const job = await soloJob(t);
    const { c, h, assignmentId: id } = job;
    await toArrived(t, job);
    const C = t.client(c.token);
    for (let i = 0; i < 30; i++) await C.call(api.chat.send, { params: { id }, body: { body: `Mesaj ${i}` } });
    await expect(C.call(api.chat.send, { params: { id }, body: { body: 'Bir daha' } })).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
    });
    expect(await t.prisma.chatMessage.count({ where: { assignmentId: id } })).toBe(30);
    // The limit is per user: the pro can still answer.
    await t.client(h.token).call(api.chat.send, { params: { id }, body: { body: 'Gəlirəm' } });

    await t.prisma.user.update({ where: { id: h.userId }, data: { status: 'BLOCKED' } });
    t.sessions.invalidateCache();
    await expect(t.client(h.token).call(api.chat.send, { params: { id }, body: { body: 'Salam' } })).rejects.toMatchObject({
      code: 'USER_BLOCKED',
      status: 403,
    });
    expect(await t.prisma.chatMessage.count({ where: { assignmentId: id } })).toBe(31);
  });

  // --------------------------------------------------------------- reassign

  it('reassign: a worker that is not APPROVED (NOT_APPROVED) or whose user is not ACTIVE (USER_INACTIVE) is refused', async () => {
    const job = await companyJob(t, { workers: 3 });
    const { co, assignmentId: id } = job;
    const w2 = co.workers[2]!;
    const M = t.client(co.manager.token);
    const call = () => M.call(api.company.reassign, { params: { companyId: co.companyId, id }, body: { workerId: w2.handymanId } });

    await t.prisma.handymanProfile.update({ where: { id: w2.handymanId }, data: { status: 'PENDING_REVIEW' } });
    await expect(call()).rejects.toMatchObject({ code: 'WORKER_UNAVAILABLE', status: 409, details: { reason: 'NOT_APPROVED' } });
    await t.prisma.handymanProfile.update({ where: { id: w2.handymanId }, data: { status: 'APPROVED' } });
    await t.prisma.user.update({ where: { id: w2.userId }, data: { status: 'DELETED' } });
    await expect(call()).rejects.toMatchObject({ code: 'WORKER_UNAVAILABLE', status: 409, details: { reason: 'USER_INACTIVE' } });
    expect((await assignmentRow(t, id)).handymanId).toBe(job.worker.handymanId);
    // Active again: the move works.
    await t.prisma.user.update({ where: { id: w2.userId }, data: { status: 'ACTIVE' } });
    expect(await call()).toMatchObject({ worker: { handymanId: w2.handymanId } });
  });

  // ------------------------------------------------------- unlock at en-route

  it('en route already within contactUnlockEtaSec: the contact unlocks at once (event, ASSIGNMENT_NEAR, phones in single views)', async () => {
    const job = await soloJob(t);
    const { c, h, assignmentId: id } = job;
    await addDevice(t, c.userId, 'CUSTOMER');
    await setSettings(t, { contactUnlockEtaSec: 3600 });
    t.realtime.clearSent();
    const pv = await t.client(h.token).call(api.pro.enRoute, { params: { id }, body: { location: BAKU.narimanov } });
    const row = await assignmentRow(t, id);
    expect(row.etaSec).not.toBeNull();
    expect(row.etaSec!).toBeLessThanOrEqual(3600);
    expect(row.contactUnlockedAt).not.toBeNull();
    expect(pv).toMatchObject({ status: 'EN_ROUTE', contactUnlocked: true, customerPhone: c.phone, chatEnabled: true });
    expect(t.realtime.sentTo(rooms.assignment(id), 'assignment:contact')).toHaveLength(1);
    expect(t.realtime.sentTo(rooms.user(c.userId), 'assignment:contact')).toHaveLength(1);
    expect(await t.prisma.notification.count({ where: { userId: c.userId, type: 'ASSIGNMENT_NEAR' } })).toBe(1);
    expect(await t.client(c.token).call(api.assignments.get, { params: { id } })).toMatchObject({ providerPhone: h.phone, contactUnlocked: true });
    for (const p of pushLog(t).sentTo(c.userId)) expect(JSON.stringify(p.message)).not.toContain(digits(h.phone));
    // Lists still carry no phone.
    const list = await t.client(h.token).call(api.pro.assignments, {});
    expect(list.items[0]!.customerPhone).toBeNull();

    // With the default threshold a far start does not unlock.
    const far = await soloJob(t);
    await setSettings(t, { contactUnlockEtaSec: 300 });
    await placeAt(t, far.h.handymanId, BAKU.ahmadli); // the server-side position is the route origin (DEMO_MODE=false)
    await t.client(far.h.token).call(api.pro.enRoute, { params: { id: far.assignmentId }, body: { location: BAKU.ahmadli } });
    expect((await assignmentRow(t, far.assignmentId)).contactUnlockedAt).toBeNull();
  });
});
