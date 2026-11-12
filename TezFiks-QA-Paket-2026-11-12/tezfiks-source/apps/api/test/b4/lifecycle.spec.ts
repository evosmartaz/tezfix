import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api } from '@tezfiks/shared';
import { createTestApp, type TestApp } from '../helpers/app';
import { BAKU, adminToken, createCompany, createCustomer, createSoloHandyman, createUser, fund, tokenFor } from '../helpers/factories';
import {
  DAY,
  HOUR,
  TRADE,
  advance,
  balanceOf,
  company,
  createProject,
  expectLedgerSound,
  notificationsOf,
  projectBody,
  quote,
  rawGet,
  relogin,
  revenue,
  solo,
  upload,
} from './helpers';

const WINDOW_MS = 0.1 * HOUR; // quoteWindowHours 0.1 = 6 minutes (inside the 15 min access-token TTL)

describe('B4 lifecycle: quote window, timers, cancellation, withdraw, validation, authorization', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
    await t.settings.update({ quoteWindowHours: 0.1 }, null);
  });

  // ------------------------------------------------------------------ window and timers

  it('the quote window closes at quoteDeadline (Clock): a quote just before is accepted, at the deadline QUOTE_WINDOW_CLOSED', async () => {
    const customer = await createCustomer(t);
    const a = await solo(t);
    const b = await solo(t);
    const p = await createProject(t, customer);
    expect(new Date(p.quoteDeadline).getTime() - new Date(p.createdAt).getTime()).toBe(WINDOW_MS);
    // The Clock keeps running in real time, so "just before" leaves a small margin for the HTTP round trip.
    t.clock.set(new Date(new Date(p.quoteDeadline).getTime() - 2000));
    const qa = await quote(t, a.token, p.id);
    expect(qa.status).toBe('SUBMITTED');
    t.clock.set(p.quoteDeadline);
    await expect(quote(t, b.token, p.id)).rejects.toMatchObject({ code: 'QUOTE_WINDOW_CLOSED', status: 409 });
    expect((await t.client(b.token).call(api.providerProjects.open)).items).toEqual([]);
    expect(await balanceOf(t, b.walletAccountId!)).toMatchObject({ held: 0 });
    // The customer may still choose among the quotes received in time.
    const awarded = await t.client(customer.token).call(api.projects.acceptQuote, { params: { id: p.id, quoteId: qa.id } });
    expect(awarded.status).toBe('AWARDED');
    await expectLedgerSound(t);
  });

  it('deadline job: no quotes -> EXPIRED with a customer notification; a job firing after the project moved on does nothing', async () => {
    const customer = await createCustomer(t);
    const p = await createProject(t, customer);
    expect(t.jobs.pending('projects.quoteDeadline').map((j) => j.runAt.toISOString())).toEqual([p.quoteDeadline]);
    await advance(t, WINDOW_MS - 1000);
    expect((await t.client(customer.token).call(api.projects.get, { params: { id: p.id } })).status).toBe('OPEN');
    await advance(t, 1000);
    const expired = await t.client(customer.token).call(api.projects.get, { params: { id: p.id } });
    expect(expired).toMatchObject({ status: 'EXPIRED', canCancel: false });
    const notes = await notificationsOf(t, customer.userId, 'GENERIC');
    expect(notes).toHaveLength(1);
    expect(notes[0]!.title).toContain(String(p.number));
    expect(t.jobs.pending('projects.awardExpiry')).toHaveLength(0);

    // A cancelled project is left alone by a late deadline job.
    const p2 = await createProject(t, customer);
    await t.client(customer.token).call(api.projects.cancel, { params: { id: p2.id } });
    await t.jobs.runNow('projects.quoteDeadline', { projectId: p2.id });
    expect((await t.prisma.project.findUniqueOrThrow({ where: { id: p2.id } })).status).toBe('CANCELLED');
  });

  it('deadline with quotes keeps the project OPEN; without an award within 7 days it EXPIRES and every quote hold is released', async () => {
    const customer = await createCustomer(t);
    const a = await solo(t);
    const co = await company(t);
    const p = await createProject(t, customer);
    const qa = await quote(t, a.token, p.id);
    const qc = await quote(t, co.manager.token, p.id, { companyId: co.companyId, workers: 2, days: 2 });
    await advance(t, WINDOW_MS);
    expect((await t.prisma.project.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('OPEN');
    const award = t.jobs.pending('projects.awardExpiry');
    expect(award).toHaveLength(1);
    expect(award[0]!.runAt.getTime()).toBe(new Date(p.quoteDeadline).getTime() + 7 * DAY);
    await advance(t, 7 * DAY - 1000);
    expect((await t.prisma.project.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('OPEN');
    await advance(t, 1000);
    expect((await t.prisma.project.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('EXPIRED');
    const quotes = await t.prisma.quote.findMany({ where: { projectId: p.id } });
    expect(quotes.map((q) => q.status)).toEqual(['EXPIRED', 'EXPIRED']);
    expect(await balanceOf(t, a.walletAccountId!)).toEqual({ posted: 100_000, held: 0, available: 100_000 });
    expect(await balanceOf(t, co.walletAccountId)).toEqual({ posted: 100_000, held: 0, available: 100_000 });
    expect(await notificationsOf(t, a.userId, 'QUOTE_REJECTED')).toHaveLength(1);
    expect(await notificationsOf(t, co.manager.userId, 'QUOTE_REJECTED')).toHaveLength(1);
    await relogin(t, a, 'PRO');
    const hist = await t.client(a.token).call(api.providerProjects.mine, { query: { scope: 'history' } });
    expect(hist.items.map((x) => x.id)).toEqual([p.id]);
    expect(hist.items[0]!.myQuote).toMatchObject({ id: qa.id, status: 'EXPIRED', feeHeld: 0 });
    expect(qc.feeHeld).toBe(4000);
    await expectLedgerSound(t);
  });

  it('reconciler expires overdue projects whose timers were lost (restart)', async () => {
    const customer = await createCustomer(t);
    const h = await solo(t);
    const empty = await createProject(t, customer);
    const quoted = await createProject(t, customer);
    await quote(t, h.token, quoted.id);
    t.jobs.clearManual();
    t.clock.advance(WINDOW_MS + 1000);
    await t.reconciler.tickAll();
    expect((await t.prisma.project.findUniqueOrThrow({ where: { id: empty.id } })).status).toBe('EXPIRED');
    expect((await t.prisma.project.findUniqueOrThrow({ where: { id: quoted.id } })).status).toBe('OPEN');
    t.clock.advance(7 * DAY);
    await t.reconciler.tickAll();
    expect((await t.prisma.project.findUniqueOrThrow({ where: { id: quoted.id } })).status).toBe('EXPIRED');
    expect(await balanceOf(t, h.walletAccountId!)).toMatchObject({ held: 0 });
    await expectLedgerSound(t);
  });

  // -------------------------------------------------------------- cancellation / withdraw

  it('cancel (OPEN only) releases every quote hold; later cancels and other customers are refused', async () => {
    const customer = await createCustomer(t);
    const stranger = await createCustomer(t);
    const a = await solo(t);
    const co = await company(t);
    const p = await createProject(t, customer);
    await quote(t, a.token, p.id);
    await quote(t, co.manager.token, p.id, { companyId: co.companyId });
    expect(await balanceOf(t, a.walletAccountId!)).toMatchObject({ held: 12_000 });
    await expect(t.client(stranger.token).call(api.projects.cancel, { params: { id: p.id } })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    const revenueBefore = await revenue(t);
    const cancelled = await t.client(customer.token).call(api.projects.cancel, { params: { id: p.id } });
    expect(cancelled).toMatchObject({ status: 'CANCELLED', canCancel: false });
    expect(cancelled.quotes.map((q) => q.status)).toEqual(['REJECTED', 'REJECTED']);
    expect(await balanceOf(t, a.walletAccountId!)).toEqual({ posted: 100_000, held: 0, available: 100_000 });
    expect(await balanceOf(t, co.walletAccountId)).toEqual({ posted: 100_000, held: 0, available: 100_000 });
    expect(await revenue(t)).toBe(revenueBefore);
    expect(t.jobs.pending('projects.quoteDeadline')).toHaveLength(0);
    expect(await notificationsOf(t, a.userId, 'QUOTE_REJECTED')).toHaveLength(1);
    await expect(t.client(customer.token).call(api.projects.cancel, { params: { id: p.id } })).rejects.toMatchObject({ code: 'CANCEL_NOT_ALLOWED', status: 409 });

    const p2 = await createProject(t, customer);
    const q2 = await quote(t, a.token, p2.id);
    await t.client(customer.token).call(api.projects.acceptQuote, { params: { id: p2.id, quoteId: q2.id } });
    await expect(t.client(customer.token).call(api.projects.cancel, { params: { id: p2.id } })).rejects.toMatchObject({ code: 'CANCEL_NOT_ALLOWED' });
    await expectLedgerSound(t);
  });

  it('withdraw releases the hold; one quote per provider even after withdrawal; nobody else can withdraw it', async () => {
    const customer = await createCustomer(t);
    const a = await solo(t);
    const b = await solo(t);
    const co = await company(t);
    const otherCo = await company(t);
    const p = await createProject(t, customer);
    const qa = await quote(t, a.token, p.id);
    const qc = await quote(t, co.manager.token, p.id, { companyId: co.companyId });
    await expect(t.client(b.token).call(api.providerProjects.withdrawQuote, { params: { id: qa.id } })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(t.client(otherCo.manager.token).call(api.providerProjects.withdrawQuote, { params: { id: qc.id } })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(t.client(co.workers[0]!.token).call(api.providerProjects.withdrawQuote, { params: { id: qc.id } })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const w = await t.client(a.token).call(api.providerProjects.withdrawQuote, { params: { id: qa.id } });
    expect(w).toMatchObject({ status: 'WITHDRAWN', feeHeld: 0 });
    expect(await balanceOf(t, a.walletAccountId!)).toEqual({ posted: 100_000, held: 0, available: 100_000 });
    await expect(t.client(a.token).call(api.providerProjects.withdrawQuote, { params: { id: qa.id } })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(quote(t, a.token, p.id)).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
    await expect(t.client(customer.token).call(api.projects.acceptQuote, { params: { id: p.id, quoteId: qa.id } })).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
    // The withdrawn quote leaves the customer's comparison.
    const detail = await t.client(customer.token).call(api.projects.get, { params: { id: p.id } });
    expect(detail.quotes.map((q) => q.id)).toEqual([qc.id]);
    expect(detail.quotesCount).toBe(1);
    // Company quote accepted: it can no longer be withdrawn; new quotes are refused.
    await t.client(customer.token).call(api.projects.acceptQuote, { params: { id: p.id, quoteId: qc.id } });
    await expect(
      t.client(co.manager.token).call(api.providerProjects.withdrawQuote, { params: { id: qc.id } }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(quote(t, b.token, p.id)).rejects.toMatchObject({ code: 'QUOTE_WINDOW_CLOSED' });
    await expectLedgerSound(t);
  });

  // ------------------------------------------------------------------ quotes: errors

  it('quote errors: INSUFFICIENT_BALANCE, CONFLICT, NOT_ELIGIBLE (trade, area, own project), approvals, roles', async () => {
    const customer = await createCustomer(t);
    const p = await createProject(t, customer);
    const poor = await solo(t, { balance: 1000 });
    await expect(quote(t, poor.token, p.id)).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE', status: 402 });
    expect(await t.prisma.quote.count()).toBe(0);
    const ok = await solo(t);
    await quote(t, ok.token, p.id);
    await expect(quote(t, ok.token, p.id, { totalAmount: 400_000 })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await balanceOf(t, ok.walletAccountId!)).toMatchObject({ held: 12_000 });

    const plumber = await createSoloHandyman(t, { trades: ['plumbing'], balance: 100_000 });
    await expect(quote(t, plumber.token, p.id)).rejects.toMatchObject({ code: 'NOT_ELIGIBLE', status: 403 });
    await expect(t.client(plumber.token).call(api.providerProjects.get, { params: { id: p.id } })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const far = await solo(t, { base: BAKU.ahmadli, radiusKm: 2 });
    await expect(quote(t, far.token, p.id)).rejects.toMatchObject({ code: 'NOT_ELIGIBLE' });

    const pending = await solo(t, { status: 'PENDING_REVIEW' });
    await expect(quote(t, pending.token, p.id)).rejects.toMatchObject({ code: 'HANDYMAN_NOT_APPROVED', status: 403 });
    await expect(t.client(pending.token).call(api.providerProjects.open)).rejects.toMatchObject({ code: 'HANDYMAN_NOT_APPROVED' });
    const draftCo = await company(t, { status: 'PENDING_REVIEW' });
    await expect(quote(t, draftCo.manager.token, p.id, { companyId: draftCo.companyId })).rejects.toMatchObject({ code: 'COMPANY_NOT_APPROVED' });

    const co = await company(t);
    const worker = co.workers[0]!;
    await expect(quote(t, worker.token, p.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(quote(t, worker.token, p.id, { companyId: co.companyId })).rejects.toMatchObject({ code: 'NOT_COMPANY_MANAGER', status: 403 });
    await expect(quote(t, co.manager.token, p.id, { companyId: crypto.randomUUID() })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(t.client(customer.token).call(api.providerProjects.open)).rejects.toMatchObject({ code: 'NOT_FOUND' });

    // A handyman who is also a customer never sees or quotes on their own project.
    const both = await solo(t);
    const accId = crypto.randomUUID();
    const wallet = await t.ledger.ensureAccount('CUSTOMER_ACCOUNT', accId, 'WALLET');
    await t.prisma.customerAccount.create({ data: { id: accId, ownerUserId: both.userId, type: 'INDIVIDUAL', walletAccountId: wallet.id } });
    const own = await t.client(both.token).call(api.projects.create, { body: await projectBody(t) });
    expect((await t.client(both.token).call(api.providerProjects.open)).items.map((x) => x.id)).not.toContain(own.id);
    await expect(quote(t, both.token, own.id)).rejects.toMatchObject({ code: 'NOT_ELIGIBLE' });
    await expectLedgerSound(t);
  });

  it('a zero b2bFeePerWorkerDay means no hold; the award still works and captures nothing', async () => {
    await t.settings.update({ b2bFeePerWorkerDay: 0 }, null);
    const customer = await createCustomer(t);
    const h = await solo(t, { balance: 0 });
    const p = await createProject(t, customer);
    const q = await quote(t, h.token, p.id);
    expect(q).toMatchObject({ feeHeld: 0, feeCaptured: false });
    expect(await t.prisma.hold.count()).toBe(0);
    await t.client(customer.token).call(api.projects.acceptQuote, { params: { id: p.id, quoteId: q.id } });
    expect((await t.prisma.quote.findUniqueOrThrow({ where: { id: q.id } })).feeCaptured).toBe(false);
    await expectLedgerSound(t);
  });

  // ------------------------------------------------------------------ idempotency

  it('create, submitQuote, acceptQuote and complete replay the same response for the same Idempotency-Key', async () => {
    const customer = await createCustomer(t, { type: 'COMPANY' });
    const h = await solo(t);
    const body = await projectBody(t);
    const c1 = await t.client(customer.token).call(api.projects.create, { body, idempotencyKey: 'proj-create-key-0001' });
    const c2 = await t.client(customer.token).call(api.projects.create, { body, idempotencyKey: 'proj-create-key-0001' });
    expect(c2.id).toBe(c1.id);
    expect(await t.prisma.project.count()).toBe(1);

    const q1 = await quote(t, h.token, c1.id, {}, 'quote-key-000000001');
    const q2 = await quote(t, h.token, c1.id, {}, 'quote-key-000000001');
    expect(q2.id).toBe(q1.id);
    expect(await t.prisma.hold.count({ where: { kind: 'B2B_QUOTE_FEE' } })).toBe(1);
    expect(await balanceOf(t, h.walletAccountId!)).toMatchObject({ held: 12_000 });

    const a1 = await t.client(customer.token).call(api.projects.acceptQuote, { params: { id: c1.id, quoteId: q1.id }, idempotencyKey: 'accept-key-00000001' });
    const a2 = await t.client(customer.token).call(api.projects.acceptQuote, { params: { id: c1.id, quoteId: q1.id }, idempotencyKey: 'accept-key-00000001' });
    expect(a2.status).toBe('AWARDED');
    expect(a1.awardedQuote?.id).toBe(q1.id);
    expect(await t.prisma.ledgerTransaction.count({ where: { kind: 'B2B_FEE_CAPTURE' } })).toBe(1);
    await expect(
      t.client(customer.token).call(api.projects.acceptQuote, { params: { id: c1.id, quoteId: q1.id }, idempotencyKey: 'accept-key-00000002' }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });

    const i1 = await t.client(h.token).call(api.providerProjects.complete, { params: { id: c1.id }, body: {}, idempotencyKey: 'complete-key-000001' });
    const i2 = await t.client(h.token).call(api.providerProjects.complete, { params: { id: c1.id }, body: {}, idempotencyKey: 'complete-key-000001' });
    expect(i2.id).toBe(i1.id);
    expect(await t.prisma.invoice.count()).toBe(1);
    await expect(
      t.client(h.token).call(api.providerProjects.complete, { params: { id: c1.id }, body: {}, idempotencyKey: 'complete-key-000002' }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expectLedgerSound(t);
  });

  // ------------------------------------------------------------------ validation

  it('create validation: account required, debt, QUOTE category for individuals, dates, photos, inactive category', async () => {
    const noAccount = await createUser(t);
    const naToken = await tokenFor(t, noAccount.userId, 'CUSTOMER');
    await expect(t.client(naToken).call(api.projects.create, { body: await projectBody(t) })).rejects.toMatchObject({
      code: 'CUSTOMER_ACCOUNT_REQUIRED',
      status: 409,
    });
    expect((await t.client(naToken).call(api.projects.list)).items).toEqual([]);

    const debtor = await createCustomer(t);
    const promo = await t.ledger.platformAccountId('PROMO');
    await t.ledger.post({
      kind: 'CANCEL_PENALTY',
      idempotencyKey: 'test-debt',
      entries: [
        { accountId: debtor.walletAccountId, amount: -1500 },
        { accountId: promo, amount: 1500 },
      ],
      allowOverdraft: [debtor.walletAccountId],
    });
    await expect(createProject(t, debtor)).rejects.toMatchObject({ code: 'CUSTOMER_IN_DEBT', status: 402 });
    await fund(t, debtor.walletAccountId, 1500);
    expect((await createProject(t, debtor)).status).toBe('OPEN');

    const c = await createCustomer(t);
    await expect(createProject(t, c, { dateFrom: '2020-01-01', dateTo: '2020-01-05' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
    const body = await projectBody(t);
    await expect(createProject(t, c, { dateFrom: body.dateTo, dateTo: body.dateFrom })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const other = await createCustomer(t);
    const foreignPhoto = await upload(t, other.token, 'REQUEST_PHOTO');
    await expect(createProject(t, c, { photoFileIds: [foreignPhoto.id] })).rejects.toMatchObject({ code: 'FILE_NOT_OWNED', status: 403 });
    const photo = await upload(t, c.token, 'REQUEST_PHOTO');
    const withPhoto = await createProject(t, c, { photoFileIds: [photo.id] });
    expect(withPhoto.photos.map((f) => f.id)).toEqual([photo.id]);
    expect(withPhoto.photos[0]!.url).toContain(photo.id);

    await t.prisma.category.update({ where: { slug: TRADE }, data: { active: false } });
    await expect(createProject(t, c)).rejects.toMatchObject({ code: 'CATEGORY_INACTIVE' });
  });

  it('reports and completion: photos, dates, statuses', async () => {
    const customer = await createCustomer(t);
    const h = await solo(t);
    const p = await createProject(t, customer);
    const q = await quote(t, h.token, p.id);
    await expect(
      t.client(h.token).call(api.providerProjects.addReport, { params: { id: p.id }, body: { note: 'erkən', progressPercent: 1 } }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(t.client(h.token).call(api.providerProjects.complete, { params: { id: p.id }, body: {} })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await t.client(customer.token).call(api.projects.acceptQuote, { params: { id: p.id, quoteId: q.id } });
    await expect(t.client(customer.token).call(api.projects.rate, { params: { id: p.id }, body: { stars: 5 } })).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
    await expect(
      t.client(customer.token).call(api.projects.guaranteeClaim, { params: { id: p.id }, body: { description: 'Hələ bitməyib amma problem var' } }),
    ).rejects.toMatchObject({ code: 'GUARANTEE_NOT_AVAILABLE' });

    const foreign = await upload(t, customer.token, 'REPORT_PHOTO');
    await expect(
      t.client(h.token).call(api.providerProjects.addReport, { params: { id: p.id }, body: { note: 'şəkil', progressPercent: 5, photoFileIds: [foreign.id] } }),
    ).rejects.toMatchObject({ code: 'FILE_NOT_OWNED' });
    await expect(
      t.client(h.token).call(api.providerProjects.addReport, { params: { id: p.id }, body: { note: 'sabah', progressPercent: 5, reportDate: '2099-01-01' } }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const photo = await upload(t, h.token, 'REPORT_PHOTO');
    const r = await t.client(h.token).call(api.providerProjects.addReport, {
      params: { id: p.id },
      body: { note: 'Şüşələr quraşdırıldı; işçilər: Əli, İlqar, Şəhla', progressPercent: 50, photoFileIds: [photo.id] },
    });
    expect(r.note).toBe('Şüşələr quraşdırıldı; işçilər: Əli, İlqar, Şəhla');
    expect(r.photos.map((f) => f.id)).toEqual([photo.id]);
    const customerView = await t.client(customer.token).call(api.projects.get, { params: { id: p.id } });
    expect(customerView.reports[0]!.photos.map((f) => f.id)).toEqual([photo.id]);

    await expect(
      t.client(h.token).call(api.providerProjects.complete, { params: { id: p.id }, body: { lines: [{ description: 'Pulsuz', amount: 0 }] } }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await t.client(h.token).call(api.providerProjects.complete, { params: { id: p.id }, body: {} });
    await expect(
      t.client(h.token).call(api.providerProjects.addReport, { params: { id: p.id }, body: { note: 'gec', progressPercent: 100 } }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
    // Rating is allowed once the work is complete (invoice issued, not yet paid).
    await t.client(customer.token).call(api.projects.rate, { params: { id: p.id }, body: { stars: 3 } });
    await expectLedgerSound(t);
  });

  // ------------------------------------------------------------------ authorization / admin

  it('authorization: other customers, other providers, user tokens on admin endpoints; admin views carry fees and the phone', async () => {
    const customer = await createCustomer(t, { type: 'COMPANY', companyName: 'Şəhər Restoranı MMC', voen: '1400057421' });
    const stranger = await createCustomer(t);
    const a = await solo(t);
    const b = await solo(t);
    const p = await createProject(t, customer);
    const qa = await quote(t, a.token, p.id);
    const qb = await quote(t, b.token, p.id, { workers: 1, days: 1, totalAmount: 100_000 });

    for (const call of [
      () => t.client(stranger.token).call(api.projects.get, { params: { id: p.id } }),
      () => t.client(stranger.token).call(api.projects.acceptQuote, { params: { id: p.id, quoteId: qa.id } }),
      () => t.client(stranger.token).call(api.projects.rate, { params: { id: p.id }, body: { stars: 1 } }),
      () => t.client(stranger.token).call(api.projects.guaranteeClaim, { params: { id: p.id }, body: { description: 'yalan şikayət' } }),
      () => t.client(stranger.token).call(api.projects.cancel, { params: { id: p.id } }),
      () => t.client(a.token).call(api.projects.get, { params: { id: p.id } }),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    }
    expect((await t.prisma.project.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('OPEN');
    expect((await t.client(stranger.token).call(api.projects.list)).items).toEqual([]);
    await expect(t.client(customer.token).call(api.projects.acceptQuote, { params: { id: p.id, quoteId: crypto.randomUUID() } })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    // Provider A sees only its own quote and fee.
    const rawA = await rawGet(t, a.token, `/provider/projects/${p.id}`);
    expect(rawA.text).toContain(qa.id);
    expect(rawA.text).not.toContain(qb.id);
    expect((rawA.json as { myQuote: { feeHeld: number } }).myQuote.feeHeld).toBe(12_000);
    expect(rawA.text).not.toContain(customer.phone);
    const rawB = await rawGet(t, b.token, `/provider/projects/${p.id}`);
    expect((rawB.json as { myQuote: { feeHeld: number } }).myQuote.feeHeld).toBe(1000);
    expect(rawB.text).not.toContain(qa.id);
    const rawMine = await rawGet(t, a.token, `/provider/projects/mine?scope=active`);
    expect(rawMine.text).not.toContain(qb.id);

    // Customers see no fee information at all, in lists either.
    const rawList = await rawGet(t, customer.token, '/projects');
    for (const k of ['feeHeld', 'feeAmount', 'feeCaptured', 'holdId']) expect(rawList.text).not.toContain(k);

    // Admin endpoints are admin-only.
    await expect(t.client(customer.token).call(api.admin.projects)).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    await expect(t.client(a.token).call(api.admin.invoices)).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const admin = await adminToken(t, { role: 'OPERATOR' });
    const detail = await t.client(admin.token).call(api.admin.project, { params: { id: p.id } });
    expect(detail.customer).toEqual({ accountId: customer.accountId, name: 'Şəhər Restoranı MMC', phone: customer.phone, voen: '1400057421' });
    expect(detail.quotes.map((q) => [q.id, q.feeHeld]).sort()).toEqual(
      [
        [qa.id, 12_000],
        [qb.id, 1000],
      ].sort(),
    );
    const open = await t.client(admin.token).call(api.admin.projects, { query: { status: 'OPEN' } });
    expect(open.items).toHaveLength(1);
    expect(open.items[0]).toMatchObject({ id: p.id, number: p.number, customerName: 'Şəhər Restoranı MMC', quotesCount: 2, workersNeeded: 4 });
    expect((await t.client(admin.token).call(api.admin.projects, { query: { status: 'PAID' } })).items).toEqual([]);
    await expect(t.client(admin.token).call(api.admin.project, { params: { id: crypto.randomUUID() } })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(t.client(admin.token).call(api.admin.markInvoicePaid, { params: { id: crypto.randomUUID() } })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('lists paginate by cursor and split active / history', async () => {
    const customer = await createCustomer(t);
    const h = await solo(t);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await createProject(t, customer)).id);
    const page1 = await t.client(customer.token).call(api.projects.list, { query: { limit: 2 } });
    expect(page1.items.map((p) => p.id)).toEqual([ids[2], ids[1]]);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await t.client(customer.token).call(api.projects.list, { query: { limit: 2, cursor: page1.nextCursor! } });
    expect(page2.items.map((p) => p.id)).toEqual([ids[0]]);
    expect(page2.nextCursor).toBeNull();
    await expect(t.client(customer.token).call(api.projects.list, { query: { cursor: 'garbage' } })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    await quote(t, h.token, ids[0]!);
    await t.client(customer.token).call(api.projects.cancel, { params: { id: ids[1]! } });
    expect((await t.client(customer.token).call(api.projects.list, { query: { scope: 'active' } })).items.map((p) => p.id).sort()).toEqual(
      [ids[0], ids[2]].sort(),
    );
    expect((await t.client(customer.token).call(api.projects.list, { query: { scope: 'history' } })).items.map((p) => p.id)).toEqual([ids[1]]);
    expect((await t.client(h.token).call(api.providerProjects.mine, { query: { scope: 'active' } })).items.map((p) => p.id)).toEqual([ids[0]]);
    expect((await t.client(h.token).call(api.providerProjects.mine)).items.map((p) => p.id)).toEqual([ids[0]]);
    const admin = await adminToken(t);
    const ap = await t.client(admin.token).call(api.admin.projects, { query: { limit: 2 } });
    expect(ap.items).toHaveLength(2);
    expect(ap.nextCursor).not.toBeNull();
  });

  it('company manager scope: a manager of two companies sees each company separately', async () => {
    const customer = await createCustomer(t);
    const co1 = await company(t);
    const co2 = await createCompany(t, { trades: [TRADE], balance: 100_000, workers: 0 });
    await t.prisma.companyMember.create({ data: { companyId: co2.companyId, userId: co1.manager.userId, role: 'MANAGER' } });
    const p = await createProject(t, customer);
    const q1 = await quote(t, co1.manager.token, p.id, { companyId: co1.companyId });
    const q2 = await quote(t, co1.manager.token, p.id, { companyId: co2.companyId, workers: 1, days: 1 });
    expect(q1.provider.companyId).toBe(co1.companyId);
    expect(q2.provider.companyId).toBe(co2.companyId);
    expect(await balanceOf(t, co2.walletAccountId)).toMatchObject({ held: 1000 });
    const v2 = await t.client(co1.manager.token).call(api.providerProjects.get, { params: { id: p.id }, query: { companyId: co2.companyId } });
    expect(v2.myQuote?.id).toBe(q2.id);
    await expectLedgerSound(t);
  });
});
