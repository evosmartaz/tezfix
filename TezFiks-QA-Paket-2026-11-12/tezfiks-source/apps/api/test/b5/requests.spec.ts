import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api } from '@tezfiks/shared';
import { createTestApp, type TestApp } from '../helpers/app';
import { adminToken, createCustomer, createSoloHandyman } from '../helpers/factories';
import {
  advance,
  companyJob,
  createRequest,
  expectLedgerSound,
  expectNoPhone,
  seedAssignment,
  seedRequest,
  setSettings,
  soloJob,
  toPriceProposed,
} from './helpers';
import { DECLINED_CARD, payWithCard } from '../b3/helpers';

describe('B5 admin requests: list, filters, search, detail with timeline', () => {
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

  it('a completed cash job: row (provider, fee, statuses) and detail with phones, offers, ledger and an ordered timeline', async () => {
    const job = await soloJob(t, { proBalance: 2000 });
    await advance(t, 301_000); // fee window closes -> fee captured
    await toPriceProposed(t, job, 4000, 1000);
    await t.client(job.c.token).call(api.assignments.confirmPrice, { params: { id: job.assignmentId }, body: { method: 'CASH' } });
    const { token } = await adminToken(t, { role: 'OPERATOR' });
    const A = t.client(token, 'en');

    const list = await A.call(api.admin.requests);
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toEqual({
      id: job.requestId,
      number: job.requestNumber,
      customerName: 'Nizami Talıbov',
      providerName: 'Elvin Məmmədov',
      categoryName: expect.any(String),
      status: 'COMPLETED',
      assignmentStatus: 'COMPLETED',
      timing: 'NOW',
      slots: 1,
      fee: 1000,
      createdAt: expect.any(String),
      isBot: false,
    });

    const d = await A.call(api.admin.request, { params: { id: job.requestId } });
    expect(d.request).toMatchObject({ id: job.requestId, status: 'COMPLETED', number: job.requestNumber });
    expect(d.customer).toEqual({
      accountId: job.c.accountId,
      userId: job.c.userId,
      name: 'Nizami Talıbov',
      phone: job.c.phone,
      type: 'INDIVIDUAL',
      companyName: null,
    });
    expect(d.assignments).toHaveLength(1);
    expect(d.assignments[0]).toMatchObject({
      id: job.assignmentId,
      status: 'COMPLETED',
      providerType: 'SOLO',
      providerName: 'Elvin Məmmədov',
      providerPhone: job.h.phone,
      customerPhone: job.c.phone,
      price: { labor: 4000, materials: 1000, total: 5000 },
      paymentMethod: 'CASH',
      fee: { amount: 1000, captured: true, refunded: false },
    });
    expect(d.offers).toHaveLength(1);
    expect(d.offers[0]).toMatchObject({ target: 'HANDYMAN', handymanName: 'Elvin Məmmədov', companyName: null, status: 'ACCEPTED', step: 0 });
    expect(d.ledger.map((x) => x.kind)).toContain('REQUEST_FEE_CAPTURE');

    const events = d.timeline.map((e) => e.event);
    for (const e of ['request.created', 'search.started', 'offers.sent', 'assignment.accepted', 'en_route', 'arrived', 'price_proposed', 'completed', 'fee.captured']) {
      expect(events).toContain(e);
    }
    const idx = (e: string) => events.indexOf(e);
    expect(idx('request.created')).toBeLessThan(idx('assignment.accepted'));
    expect(idx('assignment.accepted')).toBeLessThan(idx('en_route'));
    expect(idx('en_route')).toBeLessThan(idx('arrived'));
    expect(idx('arrived')).toBeLessThan(idx('price_proposed'));
    expect(idx('price_proposed')).toBeLessThan(idx('completed'));
    const ats = d.timeline.map((e) => Date.parse(e.at));
    expect([...ats].sort((a, b) => a - b)).toEqual(ats);
    expect(d.timeline.find((e) => e.event === 'assignment.accepted')!.actor).toBe('Elvin Məmmədov');
    expect(d.timeline.find((e) => e.event === 'request.created')!.actor).toBe('Nizami Talıbov');
    expect(d.timeline.find((e) => e.event === 'price_proposed')!.details).toContain('50.00');
    expect(d.timeline.find((e) => e.event === 'completed')!.details).toBe('Paid in cash');
    expect(d.timeline.find((e) => e.event === 'offers.sent')!.details).toContain('1 offer');
    await expectLedgerSound(t);
  });

  it('a card-paid job with a declined try and a tip: payment.failed and payment.succeeded events (job payment and tip) in order', async () => {
    const job = await soloJob(t, { proBalance: 2000 });
    await advance(t, 301_000);
    await toPriceProposed(t, job, 4000, 1000);
    const C = t.client(job.c.token);
    const id = job.assignmentId;
    const first = await C.call(api.assignments.confirmPrice, { params: { id }, body: { method: 'CARD' } });
    await advance(t, 60_000);
    await payWithCard(t, first.payment!.checkoutUrl, DECLINED_CARD);
    expect((await t.prisma.paymentIntent.findUniqueOrThrow({ where: { id: first.payment!.paymentIntentId } })).status).toBe('FAILED');
    await advance(t, 60_000);
    const retry = await C.call(api.assignments.confirmPrice, { params: { id }, body: { method: 'CARD' } });
    expect(retry.payment!.paymentIntentId).not.toBe(first.payment!.paymentIntentId);
    await advance(t, 60_000);
    await payWithCard(t, retry.payment!.checkoutUrl);
    expect((await t.prisma.assignment.findUniqueOrThrow({ where: { id } })).status).toBe('COMPLETED');
    await advance(t, 60_000);
    const tip = await C.call(api.assignments.tip, { params: { id }, body: { amount: 500 } });
    await advance(t, 60_000);
    await payWithCard(t, tip.checkoutUrl);

    const { token } = await adminToken(t);
    const d = await t.client(token, 'en').call(api.admin.request, { params: { id: job.requestId } });
    expect(d.assignments[0]).toMatchObject({ status: 'COMPLETED', paymentMethod: 'CARD' });
    const failed = d.timeline.filter((e) => e.event === 'payment.failed');
    const succeeded = d.timeline.filter((e) => e.event === 'payment.succeeded');
    expect(failed).toHaveLength(1);
    expect(succeeded).toHaveLength(2);
    expect(failed[0]).toMatchObject({ actor: 'Nizami Talıbov' });
    expect(failed[0]!.details).toContain('Job payment');
    expect(failed[0]!.details).toContain('50.00');
    expect(succeeded[0]!.details).toContain('Job payment');
    expect(succeeded[0]!.details).toContain('50.00');
    expect(succeeded[1]!.details).toContain('Tip');
    expect(succeeded[1]!.details).toContain('5.00');
    expect(d.timeline.find((e) => e.event === 'completed')!.details).toBe('Paid by card');
    // Business-time order: the declined try, then the job payment (with the completion), then the tip.
    const events = d.timeline.map((e) => e.event);
    const at = (e: { at: string }) => Date.parse(e.at);
    expect(at(failed[0]!)).toBeLessThan(at(succeeded[0]!));
    expect(at(succeeded[0]!)).toBeLessThan(at(succeeded[1]!));
    expect(events.indexOf('price_proposed')).toBeLessThan(events.indexOf('payment.failed'));
    expect(d.timeline.indexOf(succeeded[1]!)).toBe(d.timeline.length - 1);
    const ats = d.timeline.map(at);
    expect([...ats].sort((a, b) => a - b)).toEqual(ats);
    // A cancelled (superseded) checkout is not a payment event.
    expect(d.timeline.filter((e) => e.event.startsWith('payment.'))).toHaveLength(3);
    await expectLedgerSound(t);
  });

  it('an expired request: the expired event uses the search end (business time), and a customer cancel is shown once', async () => {
    const c = await createCustomer(t);
    const req = await createRequest(t, c);
    const ends = (await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: req.id } })).searchEndsAt!;
    await advance(t, ends.getTime() - t.clock.nowMs() + 60_000);
    await t.reconciler.tickAll();
    const r = await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: req.id } });
    expect(r.status).toBe('EXPIRED');
    const { token } = await adminToken(t);
    const d = await t.client(token).call(api.admin.request, { params: { id: req.id } });
    const expired = d.timeline.filter((e) => e.event === 'expired');
    expect(expired).toHaveLength(1);
    expect(expired[0]!.at).toBe(ends.toISOString());

    const job = await soloJob(t, { proBalance: 2000 });
    await t.client(job.c.token).call(api.requests.cancel, { params: { id: job.requestId }, body: { reason: 'Fikrimi dəyişdim' } });
    const d2 = await t.client(token).call(api.admin.request, { params: { id: job.requestId } });
    expect(d2.request.status).toBe('CANCELLED');
    expect(d2.timeline.filter((e) => e.event === 'cancelled')).toHaveLength(1);
    expect(d2.timeline.find((e) => e.event === 'cancelled')!.actor).toBe('Nizami Talıbov');
    await expectLedgerSound(t);
  });

  it('phones are in admin views only: the customer and pro views of the same running job never carry the other party’s phone', async () => {
    const job = await soloJob(t, { proBalance: 2000 });
    const { token } = await adminToken(t);
    const d = await t.client(token).call(api.admin.request, { params: { id: job.requestId } });
    expect(JSON.stringify(d)).toContain(job.h.phone);
    expect(JSON.stringify(d)).toContain(job.c.phone);

    const customerView = await t.client(job.c.token).call(api.requests.get, { params: { id: job.requestId } });
    expectNoPhone(customerView, job.h.phone);
    const proList = await t.client(job.h.token).call(api.pro.assignments, { query: {} });
    expectNoPhone(proList, job.c.phone);
    const proView = await t.client(job.h.token).call(api.pro.assignment, { params: { id: job.assignmentId } });
    expectNoPhone(proView, job.c.phone);
  });

  it('company jobs: the row names worker and company; the detail shows the worker phone and company', async () => {
    const job = await companyJob(t);
    const { token } = await adminToken(t);
    const row = (await t.client(token).call(api.admin.requests)).items[0]!;
    expect(row.providerName).toBe('Rauf Hüseynov (FixPro MMC)');
    expect(row.assignmentStatus).toBe('ACCEPTED');
    expect(row.status).toBe('ASSIGNED');
    expect(row.fee).toBe(0);
    const d = await t.client(token).call(api.admin.request, { params: { id: job.requestId } });
    expect(d.assignments[0]).toMatchObject({ providerType: 'COMPANY', providerName: 'Rauf Hüseynov', providerPhone: job.worker.phone, companyName: 'FixPro MMC' });
    expect(d.offers[0]).toMatchObject({ target: 'COMPANY', companyName: 'FixPro MMC', handymanName: null });
  });

  it('filters by status and date range, searches number / names (tz_fold) / phones, pages with a cursor', async () => {
    const nizami = await createCustomer(t, { firstName: 'Nizami', lastName: 'Talıbov' });
    const ismayil = await createCustomer(t, { firstName: 'İsmayıl', lastName: 'Şükürov' });
    const kontur = await createCustomer(t, { type: 'COMPANY', companyName: 'Kontur MMC', firstName: 'Aysel', lastName: 'Qasımova' });
    const pro = await createSoloHandyman(t, { firstName: 'Vüqar', lastName: 'Nəbiyev' });
    const base = Date.parse('2026-10-20T08:00:00.000Z');
    const at = (h: number) => new Date(base + h * 3_600_000);
    const r1 = await seedRequest(t, nizami, { createdAt: at(0), status: 'COMPLETED' });
    const r2 = await seedRequest(t, ismayil, { createdAt: at(1), status: 'CANCELLED' });
    const r3 = await seedRequest(t, kontur, { createdAt: at(2), status: 'EXPIRED' });
    const r4 = await seedRequest(t, nizami, { createdAt: at(30), status: 'COMPLETED' });
    const r5 = await seedRequest(t, ismayil, { createdAt: at(31), status: 'SEARCHING', isDemo: true });
    await seedAssignment(t, r4.id, { handymanId: pro.handymanId, userId: pro.userId, acceptedAt: at(30.1) });
    const { token } = await adminToken(t);
    const A = t.client(token);
    const ids = async (query: Record<string, unknown>) => (await A.call(api.admin.requests, { query: { limit: 100, ...query } })).items.map((i) => i.id);

    expect(await ids({})).toEqual([r5.id, r4.id, r3.id, r2.id, r1.id]);
    expect(await ids({ status: 'COMPLETED' })).toEqual([r4.id, r1.id]);
    expect(await ids({ from: at(1).toISOString(), to: at(2).toISOString() })).toEqual([r3.id, r2.id]);
    expect(await ids({ from: at(29).toISOString() })).toEqual([r5.id, r4.id]);
    expect(await ids({ q: 'ismayil' })).toEqual([r5.id, r2.id]);
    expect(await ids({ q: 'ŞÜKÜROV' })).toEqual([r5.id, r2.id]);
    expect(await ids({ q: 'talibov' })).toEqual([r4.id, r1.id]);
    expect(await ids({ q: 'kontur' })).toEqual([r3.id]);
    expect(await ids({ q: 'vuqar' })).toEqual([r4.id]);
    expect(await ids({ q: `#${r3.number}` })).toEqual([r3.id]);
    expect(await ids({ q: String(r1.number) })).toEqual([r1.id]);
    const local = `0${nizami.phone.slice(4, 6)} ${nizami.phone.slice(6, 9)} ${nizami.phone.slice(9, 11)} ${nizami.phone.slice(11)}`;
    expect(await ids({ q: local })).toEqual([r4.id, r1.id]);
    expect(await ids({ q: pro.phone })).toEqual([r4.id]);
    expect(await ids({ q: 'heç kim' })).toEqual([]);

    const rows = (await A.call(api.admin.requests, { query: { limit: 100 } })).items;
    expect(rows.find((r) => r.id === r5.id)!.isBot).toBe(true);
    expect(rows.find((r) => r.id === r4.id)).toMatchObject({ isBot: false, providerName: 'Vüqar Nəbiyev', fee: 1000, assignmentStatus: 'COMPLETED' });
    expect(rows.find((r) => r.id === r3.id)).toMatchObject({ customerName: 'Aysel Qasımova', providerName: null, assignmentStatus: null, fee: 0 });

    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await A.call(api.admin.requests, { query: { limit: 2, ...(cursor ? { cursor } : {}) } });
      seen.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor ?? undefined;
      pages++;
    } while (cursor);
    expect(pages).toBe(3);
    expect(seen).toEqual([r5.id, r4.id, r3.id, r2.id, r1.id]);
    await expect(A.call(api.admin.requests, { query: { cursor: 'not-a-cursor' } })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
    const bad = await fetch(`${t.baseUrl}/admin/requests?status=NOPE`, { headers: { Authorization: `Bearer ${token}` } });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
  });

  it('requests served by a bot handyman are flagged isBot', async () => {
    const c = await createCustomer(t);
    const bot = await createSoloHandyman(t, { firstName: 'Bot', lastName: 'Usta' });
    await t.prisma.handymanProfile.update({ where: { id: bot.handymanId }, data: { isBot: true } });
    const r = await seedRequest(t, c, { createdAt: t.clock.now() });
    await seedAssignment(t, r.id, { handymanId: bot.handymanId, userId: bot.userId, acceptedAt: t.clock.now() });
    const { token } = await adminToken(t);
    expect((await t.client(token).call(api.admin.requests)).items[0]).toMatchObject({ id: r.id, isBot: true });
  });

  it('unknown request is NOT_FOUND; users cannot use admin request endpoints', async () => {
    const { token } = await adminToken(t);
    await expect(t.client(token).call(api.admin.request, { params: { id: '0192f000-0000-7000-8000-000000000001' } })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
    const c = await createCustomer(t);
    await expect(t.client(c.token).call(api.admin.requests)).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
  });
});
