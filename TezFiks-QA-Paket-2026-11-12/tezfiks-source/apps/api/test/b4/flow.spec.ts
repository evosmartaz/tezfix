import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, bakuDayKey } from '@tezfiks/shared';
import { createTestApp, type TestApp } from '../helpers/app';
import { BAKU, adminToken, createCustomer, createSoloHandyman, tokenFor } from '../helpers/factories';
import {
  DAY,
  TRADE,
  advance,
  balanceOf,
  company,
  createProject,
  expectLedgerSound,
  notificationsOf,
  quote,
  rawGet,
  revenue,
  solo,
} from './helpers';

describe('B4 full B2B flow: two competing quotes (solo + company), award, reports, invoice, payment, rating, guarantee', () => {
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

  it('company wins: fee holds/captures/releases with balances, VAT invoice, admin mark paid -> company earnings, rating, guarantee case', async () => {
    const customer = await createCustomer(t, { type: 'COMPANY', companyName: 'Kontur MMC', voen: '1234567890' });
    const h = await solo(t, { balance: 50_000 });
    const co = await company(t, { balance: 50_000, vatPayer: true, voen: '9988776655', name: 'Usta Servis MMC' });
    const plumber = await createSoloHandyman(t, { trades: ['plumbing'], balance: 50_000 });
    const far = await solo(t, { base: BAKU.ahmadli, radiusKm: 2 });
    const pending = await solo(t, { status: 'PENDING_REVIEW' });

    // ---- create
    const created = await createProject(t, customer);
    expect(created).toMatchObject({ status: 'OPEN', quotesCount: 0, workersNeeded: 4, canCancel: true, invoice: null, awardedQuote: null, rated: false });
    expect(created.address.apartment).toBe('ofis 45');
    expect(new Date(created.quoteDeadline).getTime()).toBe(new Date(created.createdAt).getTime() + 24 * 60 * 60_000);
    const row = await t.prisma.project.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.workDays).toBe(3);
    expect(t.jobs.pending('projects.quoteDeadline')).toHaveLength(1);

    // ---- PROJECT_NEW only to eligible providers (solo with the trade covering the site; managers of companies covering it)
    expect(await notificationsOf(t, h.userId, 'PROJECT_NEW')).toHaveLength(1);
    expect(await notificationsOf(t, co.manager.userId, 'PROJECT_NEW')).toHaveLength(1);
    expect(await notificationsOf(t, co.workers[0]!.userId, 'PROJECT_NEW')).toHaveLength(0);
    expect(await notificationsOf(t, plumber.userId, 'PROJECT_NEW')).toHaveLength(0);
    expect(await notificationsOf(t, far.userId, 'PROJECT_NEW')).toHaveLength(0);
    expect(await notificationsOf(t, pending.userId, 'PROJECT_NEW')).toHaveLength(0);
    const [newNote] = await notificationsOf(t, h.userId, 'PROJECT_NEW');
    expect(newNote!.body).toContain(String(created.number));
    expect(JSON.stringify(newNote)).not.toContain(customer.phone);

    // ---- provider open lists: area-level address only, fee per worker-day, no customer phone
    const open = await t.client(h.token).call(api.providerProjects.open);
    expect(open.items.map((p) => p.id)).toEqual([created.id]);
    expect(open.items[0]).toMatchObject({ feePerWorkerDay: 1000, myQuote: null, isAwardedToMe: false, reports: [], invoice: null });
    expect(open.items[0]!.address).toMatchObject({ apartment: null, entrance: null, floor: null, intercom: null, note: null, street: 'Nizami küçəsi' });
    expect(open.items[0]!.addressText).not.toContain('ofis 45');
    expect(open.items[0]!.customer).toEqual({ name: 'Kontur MMC', type: 'COMPANY', ratingAvg: null });
    expect((await t.client(co.manager.token).call(api.providerProjects.open, { query: { companyId: co.companyId } })).items).toHaveLength(1);
    expect((await t.client(plumber.token).call(api.providerProjects.open)).items).toEqual([]);
    expect((await t.client(far.token).call(api.providerProjects.open)).items).toEqual([]);
    const rawOpen = await rawGet(t, h.token, '/provider/projects/open');
    expect(rawOpen.text).not.toContain(customer.phone);

    // ---- quotes: fee = b2bFeePerWorkerDay x workers x days held on the provider wallet
    const soloQuote = await quote(t, h.token, created.id, { totalAmount: 800_000, workers: 4, days: 3, note: 'Material daxil deyil' });
    expect(soloQuote).toMatchObject({ status: 'SUBMITTED', feeHeld: 12_000, feeCaptured: false, totalAmount: 800_000 });
    expect(soloQuote.provider).toMatchObject({ type: 'SOLO', handymanId: h.handymanId, name: 'Elvin Məmmədov', isVatPayer: false });
    const coQuote = await quote(t, co.manager.token, created.id, { companyId: co.companyId, totalAmount: 900_000, workers: 5, days: 3 });
    expect(coQuote).toMatchObject({ status: 'SUBMITTED', feeHeld: 15_000, feeCaptured: false });
    expect(coQuote.provider).toMatchObject({ type: 'COMPANY', companyId: co.companyId, name: 'Usta Servis MMC', isVatPayer: true });
    expect(await balanceOf(t, h.walletAccountId!)).toEqual({ posted: 50_000, held: 12_000, available: 38_000 });
    expect(await balanceOf(t, co.walletAccountId)).toEqual({ posted: 50_000, held: 15_000, available: 35_000 });
    expect(await notificationsOf(t, customer.userId, 'QUOTE_RECEIVED')).toHaveLength(2);
    await expectLedgerSound(t);

    // ---- customer compares: both quotes, no fee data anywhere in the JSON
    const compare = await t.client(customer.token).call(api.projects.get, { params: { id: created.id } });
    expect(compare.quotesCount).toBe(2);
    expect(compare.quotes.map((q) => q.id).sort()).toEqual([soloQuote.id, coQuote.id].sort());
    const rawCustomer = await rawGet(t, customer.token, `/projects/${created.id}`);
    expect(rawCustomer.status).toBe(200);
    for (const k of ['feeHeld', 'feeAmount', 'feeCaptured', 'holdId', 'feePerWorkerDay']) expect(rawCustomer.text).not.toContain(k);

    // ---- other providers never see each other's quotes or fees
    const rawSoloView = await rawGet(t, h.token, `/provider/projects/${created.id}`);
    expect(rawSoloView.text).not.toContain(coQuote.id);
    expect(rawSoloView.text).not.toContain('15000');

    // ---- accept the company quote
    const revenueBefore = await revenue(t);
    const awarded = await t.client(customer.token).call(api.projects.acceptQuote, { params: { id: created.id, quoteId: coQuote.id } });
    expect(awarded).toMatchObject({ status: 'AWARDED', canCancel: false });
    expect(awarded.awardedQuote?.id).toBe(coQuote.id);
    expect(awarded.quotes.find((q) => q.id === soloQuote.id)?.status).toBe('REJECTED');
    expect(await balanceOf(t, co.walletAccountId)).toEqual({ posted: 35_000, held: 0, available: 35_000 });
    expect(await balanceOf(t, h.walletAccountId!)).toEqual({ posted: 50_000, held: 0, available: 50_000 });
    expect((await revenue(t)) - revenueBefore).toBe(15_000);
    const captureTx = await t.prisma.ledgerTransaction.findUniqueOrThrow({ where: { idempotencyKey: `b2b-capture:${coQuote.id}` } });
    expect(captureTx).toMatchObject({ kind: 'B2B_FEE_CAPTURE', projectId: created.id });
    const holds = await t.prisma.hold.findMany({ where: { kind: 'B2B_QUOTE_FEE' } });
    expect(holds.find((x) => x.quoteId === coQuote.id)?.status).toBe('CAPTURED');
    expect(holds.find((x) => x.quoteId === soloQuote.id)?.status).toBe('RELEASED');
    const won = await t.prisma.quote.findUniqueOrThrow({ where: { id: coQuote.id } });
    expect(won.terms).toMatchObject({ quoteId: coQuote.id, totalAmount: 900_000, workers: 5, days: 3, providerName: 'Usta Servis MMC', fee: 15_000 });
    expect(await notificationsOf(t, co.manager.userId, 'QUOTE_ACCEPTED')).toHaveLength(1);
    expect(await notificationsOf(t, h.userId, 'QUOTE_REJECTED')).toHaveLength(1);
    expect(t.jobs.pending('projects.quoteDeadline')).toHaveLength(0);
    await expectLedgerSound(t);

    // ---- provider views after the award
    const soloView = await t.client(h.token).call(api.providerProjects.get, { params: { id: created.id } });
    expect(soloView).toMatchObject({ isAwardedToMe: false, reports: [], invoice: null });
    expect(soloView.myQuote).toMatchObject({ status: 'REJECTED', feeHeld: 0, feeCaptured: false });
    expect(soloView.address.apartment).toBeNull();
    const coView = await t.client(co.manager.token).call(api.providerProjects.get, { params: { id: created.id }, query: { companyId: co.companyId } });
    expect(coView).toMatchObject({ isAwardedToMe: true, status: 'AWARDED' });
    expect(coView.myQuote).toMatchObject({ status: 'ACCEPTED', feeHeld: 15_000, feeCaptured: true });
    expect(coView.address).toMatchObject({ apartment: 'ofis 45', intercom: 'domofon 45#', entrance: '2-ci giriş' });

    // ---- daily reports by the awarded provider; the loser cannot report
    const r1 = await t.client(co.manager.token).call(api.providerProjects.addReport, {
      params: { id: created.id },
      body: { companyId: co.companyId, note: 'Birinci gün: divarlar hazırlandı', progressPercent: 30 },
    });
    expect(r1).toMatchObject({ progressPercent: 30, reportDate: bakuDayKey(t.clock.now()), authorName: 'Fuad İdarəçi', photos: [] });
    expect((await t.client(customer.token).call(api.projects.get, { params: { id: created.id } })).status).toBe('IN_PROGRESS');
    await expect(
      t.client(h.token).call(api.providerProjects.addReport, { params: { id: created.id }, body: { note: 'x', progressPercent: 10 } }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    await t.client(co.manager.token).call(api.providerProjects.addReport, {
      params: { id: created.id },
      body: { companyId: co.companyId, note: 'İkinci gün: döşəmə', progressPercent: 70 },
    });
    expect(await notificationsOf(t, customer.userId, 'PROJECT_REPORT')).toHaveLength(2);
    const withReports = await t.client(customer.token).call(api.projects.get, { params: { id: created.id } });
    expect(withReports.reports.map((r) => r.progressPercent)).toEqual([70, 30]);

    // ---- complete -> invoice TF-<yyyy>-000001 with 18% VAT (company is a VAT payer)
    await expect(
      t.client(h.token).call(api.providerProjects.complete, { params: { id: created.id }, body: {} }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const invoice = await t.client(co.manager.token).call(api.providerProjects.complete, { params: { id: created.id }, body: { companyId: co.companyId } });
    const year = bakuDayKey(t.clock.now()).slice(0, 4);
    expect(invoice).toMatchObject({
      number: `TF-${year}-000001`,
      projectId: created.id,
      projectNumber: created.number,
      subtotal: 900_000,
      vatRatePercent: 18,
      vatAmount: 162_000,
      total: 1_062_000,
      currency: 'AZN',
      status: 'ISSUED',
      paidAt: null,
      issuer: { type: 'COMPANY', name: 'Usta Servis MMC', voen: '9988776655', isVatPayer: true },
      customer: { name: 'Kontur MMC', voen: '1234567890' },
    });
    expect(invoice.lines).toHaveLength(1);
    expect(invoice.lines[0]!.amount).toBe(900_000);
    expect(invoice.lines[0]!.description).toContain(String(created.number));
    const invoiced = await t.client(customer.token).call(api.projects.get, { params: { id: created.id } });
    expect(invoiced.status).toBe('INVOICED');
    expect(invoiced.invoice?.id).toBe(invoice.id);
    expect(await notificationsOf(t, customer.userId, 'INVOICE_ISSUED')).toHaveLength(1);
    expect((await t.prisma.company.findUniqueOrThrow({ where: { id: co.companyId } })).completedCount).toBe(1);

    // ---- admin: invoice list, mark paid -> provider EARNINGS, project PAID with guarantee
    const admin = await adminToken(t);
    const invoices = await t.client(admin.token).call(api.admin.invoices);
    expect(invoices.items.map((i) => i.id)).toEqual([invoice.id]);
    const earningsBefore = (await balanceOf(t, co.earningsAccountId)).posted;
    const paid = await t.client(admin.token).call(api.admin.markInvoicePaid, { params: { id: invoice.id } });
    expect(paid).toMatchObject({ status: 'PAID' });
    expect(paid.paidAt).not.toBeNull();
    expect((await balanceOf(t, co.earningsAccountId)).posted - earningsBefore).toBe(1_062_000);
    expect(await t.prisma.ledgerTransaction.count({ where: { kind: 'INVOICE_PAYMENT', invoiceId: invoice.id } })).toBe(1);
    const paidProject = await t.client(customer.token).call(api.projects.get, { params: { id: created.id } });
    expect(paidProject.status).toBe('PAID');
    expect(new Date(paidProject.guaranteeUntil!).getTime()).toBe(new Date(paid.paidAt!).getTime() + 14 * DAY);
    const audit = await t.prisma.auditLog.findFirst({ where: { action: 'invoice.markPaid', entityId: invoice.id } });
    expect(audit).toMatchObject({ actorType: 'ADMIN', actorId: admin.adminId, entityType: 'Invoice' });
    expect(await notificationsOf(t, co.manager.userId, 'INVOICE_PAID')).toHaveLength(1);
    expect(await notificationsOf(t, customer.userId, 'INVOICE_PAID')).toHaveLength(1);
    await expect(t.client(admin.token).call(api.admin.markInvoicePaid, { params: { id: invoice.id } })).rejects.toMatchObject({
      code: 'INVALID_STATE',
      status: 409,
    });
    await expectLedgerSound(t);

    // ---- rating once
    await t.client(customer.token).call(api.projects.rate, { params: { id: created.id }, body: { stars: 5, comment: 'Əla iş, təşəkkürlər!' } });
    const rated = await t.prisma.company.findUniqueOrThrow({ where: { id: co.companyId } });
    expect({ sum: rated.ratingSum, count: rated.ratingCount }).toEqual({ sum: 5, count: 1 });
    expect((await t.client(customer.token).call(api.projects.get, { params: { id: created.id } })).rated).toBe(true);
    await expect(t.client(customer.token).call(api.projects.rate, { params: { id: created.id }, body: { stars: 4 } })).rejects.toMatchObject({
      code: 'ALREADY_RATED',
      status: 409,
    });
    const rating = await t.prisma.rating.findFirstOrThrow({ where: { projectId: created.id } });
    expect(rating.comment).toBe('Əla iş, təşəkkürlər!');

    // ---- guarantee claim -> GUARANTEE case (projectId) for the admin case endpoints
    const claim = await t.client(customer.token).call(api.projects.guaranteeClaim, {
      params: { id: created.id },
      body: { description: 'Döşəmədə çatlar əmələ gəldi' },
    });
    expect(claim).toMatchObject({
      type: 'GUARANTEE',
      status: 'OPEN',
      projectId: created.id,
      projectNumber: created.number,
      assignmentId: null,
      requestNumber: null,
      followUpRequestId: null,
      resolutionNote: null,
    });
    const caseRow = await t.prisma.case.findUniqueOrThrow({ where: { id: claim.id } });
    expect(caseRow).toMatchObject({ type: 'GUARANTEE', projectId: created.id, openedByUserId: customer.userId });
    expect(t.realtime.sentTo('admins', 'admin:event').some((e) => (e.payload as { type: string }).type === 'CASE_OPENED')).toBe(true);
    await expect(
      t.client(customer.token).call(api.projects.guaranteeClaim, { params: { id: created.id }, body: { description: 'Yenə çatlar var' } }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await t.prisma.case.update({ where: { id: claim.id }, data: { status: 'RESOLVED' } });
    t.clock.advance(15 * DAY);
    customer.token = await tokenFor(t, customer.userId, 'CUSTOMER');
    co.manager.token = await tokenFor(t, co.manager.userId, 'PRO');
    await expect(
      t.client(customer.token).call(api.projects.guaranteeClaim, { params: { id: created.id }, body: { description: 'Gec müraciət edirəm' } }),
    ).rejects.toMatchObject({ code: 'GUARANTEE_NOT_AVAILABLE', status: 409 });

    // ---- lists
    const mineCo = await t.client(co.manager.token).call(api.providerProjects.mine, { query: { companyId: co.companyId, scope: 'history' } });
    expect(mineCo.items.map((p) => p.id)).toEqual([created.id]);
    expect((await t.client(co.manager.token).call(api.providerProjects.mine, { query: { companyId: co.companyId, scope: 'active' } })).items).toEqual([]);
    expect((await t.client(customer.token).call(api.projects.list, { query: { scope: 'history' } })).items.map((p) => p.id)).toEqual([created.id]);
    expect((await t.client(customer.token).call(api.projects.list, { query: { scope: 'active' } })).items).toEqual([]);
    await expectLedgerSound(t);
  });

  it('solo wins: non-VAT invoice with custom lines, solo earnings, sequential invoice numbers across projects', async () => {
    const customer = await createCustomer(t, { firstName: 'Səbinə', lastName: 'Qasımova' });
    const h = await solo(t);
    const other = await solo(t, { firstName: 'Orxan', lastName: 'Şükürov' });

    const p1 = await createProject(t, customer);
    const p2 = await createProject(t, customer, { title: 'Dam', scope: 'Dam örtüyü 120 m²', slug: 'roofing' });
    await t.prisma.handymanTrade.create({ data: { handymanId: h.handymanId, categoryId: (await t.prisma.category.findUniqueOrThrow({ where: { slug: 'roofing' } })).id } });

    // Individual customers appear to providers as first name + last-name initial.
    const view = await t.client(h.token).call(api.providerProjects.get, { params: { id: p1.id } });
    expect(view.customer).toEqual({ name: 'Səbinə Q.', type: 'INDIVIDUAL', ratingAvg: null });

    const q1 = await quote(t, h.token, p1.id, { totalAmount: 300_000, workers: 2, days: 2 });
    const q1b = await quote(t, other.token, p1.id, { totalAmount: 250_000, workers: 3, days: 3 });
    const q2 = await quote(t, h.token, p2.id, { totalAmount: 120_000, workers: 1, days: 1 });
    expect(q1.feeHeld).toBe(4000);
    expect(q1b.feeHeld).toBe(9000);
    expect(q2.feeHeld).toBe(1000);
    expect(await balanceOf(t, h.walletAccountId!)).toMatchObject({ held: 5000, available: 95_000 });

    await t.client(customer.token).call(api.projects.acceptQuote, { params: { id: p1.id, quoteId: q1.id } });
    await t.client(customer.token).call(api.projects.acceptQuote, { params: { id: p2.id, quoteId: q2.id } });
    expect(await balanceOf(t, h.walletAccountId!)).toEqual({ posted: 95_000, held: 0, available: 95_000 });
    expect(await balanceOf(t, other.walletAccountId!)).toEqual({ posted: 100_000, held: 0, available: 100_000 });

    // Completing straight from AWARDED is allowed (no report required).
    const inv1 = await t.client(h.token).call(api.providerProjects.complete, {
      params: { id: p1.id },
      body: {
        lines: [
          { description: 'İş haqqı', amount: 250_000 },
          { description: 'Material xərci', amount: 83_333 },
        ],
      },
    });
    expect(inv1).toMatchObject({
      subtotal: 333_333,
      vatRatePercent: 0,
      vatAmount: 0,
      total: 333_333,
      issuer: { type: 'SOLO', name: 'Elvin Məmmədov', voen: null, isVatPayer: false },
      customer: { name: 'Səbinə Qasımova', voen: null },
    });
    expect(inv1.lines).toEqual([
      { description: 'İş haqqı', amount: 250_000 },
      { description: 'Material xərci', amount: 83_333 },
    ]);
    const inv2 = await t.client(h.token).call(api.providerProjects.complete, { params: { id: p2.id }, body: {} });
    const year = bakuDayKey(t.clock.now()).slice(0, 4);
    expect([inv1.number, inv2.number]).toEqual([`TF-${year}-000001`, `TF-${year}-000002`]);
    expect(inv2.total).toBe(120_000);

    const admin = await adminToken(t);
    await t.client(admin.token).call(api.admin.markInvoicePaid, { params: { id: inv1.id } });
    expect(await balanceOf(t, h.earningsAccountId!)).toMatchObject({ posted: 333_333 });
    await t.client(admin.token).call(api.admin.markInvoicePaid, { params: { id: inv2.id } });
    expect(await balanceOf(t, h.earningsAccountId!)).toMatchObject({ posted: 453_333 });

    await t.client(customer.token).call(api.projects.rate, { params: { id: p1.id }, body: { stars: 4 } });
    const prof = await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: h.handymanId } });
    expect({ sum: prof.ratingSum, count: prof.ratingCount, completed: prof.completedCount }).toEqual({ sum: 4, count: 1, completed: 2 });
    const rateNote = await notificationsOf(t, h.userId, 'GENERIC');
    expect(rateNote.some((n) => n.body.includes(String(p1.number)))).toBe(true);
    await expectLedgerSound(t);
  });

  it('VAT is rounded half-up on the subtotal for VAT payers', async () => {
    const customer = await createCustomer(t, { type: 'COMPANY' });
    const co = await company(t, { vatPayer: true });
    const p = await createProject(t, customer);
    const q = await quote(t, co.manager.token, p.id, { companyId: co.companyId, totalAmount: 333_333, workers: 1, days: 1 });
    await t.client(customer.token).call(api.projects.acceptQuote, { params: { id: p.id, quoteId: q.id } });
    const inv = await t.client(co.manager.token).call(api.providerProjects.complete, { params: { id: p.id }, body: { companyId: co.companyId } });
    // 333 333 x 18 % = 59 999.94 -> 60 000
    expect(inv).toMatchObject({ subtotal: 333_333, vatRatePercent: 18, vatAmount: 60_000, total: 393_333 });
    await expectLedgerSound(t);
  });

  it('a company customer may order an INSTANT service as a project; an individual customer only QUOTE categories', async () => {
    const biz = await createCustomer(t, { type: 'COMPANY' });
    const person = await createCustomer(t);
    const p = await createProject(t, biz, { slug: 'plumbing' });
    expect(p.category.slug).toBe('plumbing');
    await expect(createProject(t, person, { slug: 'plumbing' })).rejects.toMatchObject({ code: 'CATEGORY_NOT_INSTANT', status: 400 });
    const ok = await createProject(t, person, { slug: TRADE });
    expect(ok.status).toBe('OPEN');
    // A provider with the instant trade covering the site gets the company's project.
    const plumber = await createSoloHandyman(t, { trades: ['plumbing'], balance: 10_000 });
    expect((await t.client(plumber.token).call(api.providerProjects.open)).items.map((x) => x.id)).toEqual([p.id]);
    await advance(t, 0);
  });
});
