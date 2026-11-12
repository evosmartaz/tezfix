import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, haversineMeters, normalizeAzMobile } from '@tezfiks/shared';
import type { TestApp } from '../helpers/app';
import { BAKU, adminToken, categoryId, createCompany, createCustomer, createUser } from '../helpers/factories';
import { DEFAULT_DEMO_CONFIG, DEMO_CUSTOMER } from '../../src/modules/demo/demo.constants';
import { OffersService } from '../../src/modules/requests/offers.service';
import { PresenceService } from '../../src/modules/realtime/presence.service';
import { createDemoApp, expectLedgerBalanced } from './helpers';

describe('demo bots, config and test requests (DEMO_MODE=true)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createDemoApp();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
  });

  const near = (lat: number, lng: number) => ({
    lat,
    lng,
    formatted: 'Nizami küçəsi 67, Səbail',
    street: 'Nizami küçəsi',
    building: '67',
  });

  // ------------------------------------------------------------------ state

  it('returns the state with the default config and no bots', async () => {
    const { token } = await adminToken(t);
    const s = await t.client(token).call(api.admin.demoState, {});
    expect(s).toEqual({ enabled: true, config: DEFAULT_DEMO_CONFIG, bots: [] });
    expect(DEFAULT_DEMO_CONFIG).toEqual({
      autoAccept: true,
      acceptDelaySec: 4,
      speedKmh: 40,
      autoArrive: true,
      autoPrice: true,
      priceLabor: 3500,
      priceMaterials: 1000,
    });
  });

  // ------------------------------------------------------------------ spawn

  it('spawns approved, online, funded solo bots inside the circle (P1 DemoConsole body)', async () => {
    const { token, adminId } = await adminToken(t);
    const center = BAKU.narimanov;
    const s = await t.client(token).call(api.admin.demoSpawnBots, { body: { count: 3, radiusKm: 2, center } });
    expect(s.enabled).toBe(true);
    expect(s.bots).toHaveLength(3);
    const featured = await t.prisma.category.findMany({ where: { kind: 'SERVICE', active: true, featured: true, flow: 'INSTANT' } });
    expect(featured.length).toBeGreaterThan(0);
    for (const b of s.bots) {
      expect(haversineMeters(center, b)).toBeLessThanOrEqual(2000 + 1);
      expect(b.busy).toBe(false);
      expect(b.companyName).toBeNull();
      expect(b.name).toMatch(/^\S+ \S+$/);
      expect([...b.trades].sort()).toEqual(featured.map((c) => c.nameAz).sort());

      const p = await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: b.handymanId }, include: { user: true, serviceCells: true } });
      expect(p).toMatchObject({ isBot: true, kind: 'SOLO', status: 'APPROVED', isOnline: true, companyId: null });
      expect(p.serviceCells.length).toBeGreaterThan(0);
      expect(p.user.status).toBe('ACTIVE');
      expect(p.user.phone.startsWith('+99400')).toBe(true);
      // Bot numbers are not valid mobiles: nobody can ever log into a bot with OTP.
      expect(normalizeAzMobile(p.user.phone)).toBeNull();

      const wallet = await t.ledger.balance(p.walletAccountId!);
      expect(wallet).toEqual({ posted: 10_000, held: 0, available: 10_000 });
      const tx = await t.prisma.ledgerTransaction.findUniqueOrThrow({ where: { idempotencyKey: `demo-bot-fund:${p.id}` } });
      expect(tx.kind).toBe('ADMIN_ADJUSTMENT');

      const live = await t.app.get(PresenceService).get(p.id);
      expect(live?.online).toBe(true);
      expect(live?.lat).toBeCloseTo(b.lat, 5);
    }
    const audit = await t.prisma.auditLog.findFirstOrThrow({ where: { action: 'demo.spawnBots' } });
    expect(audit).toMatchObject({ actorType: 'ADMIN', actorId: adminId });
    await expectLedgerBalanced(t);
  });

  it('defaults to Baku centre and a 3 km radius, and uses the given trades', async () => {
    const { token } = await adminToken(t);
    const plumbing = await categoryId(t, 'plumbing');
    const s = await t.client(token).call(api.admin.demoSpawnBots, { body: { count: 2, tradeIds: [plumbing] } });
    for (const b of s.bots) {
      expect(haversineMeters(BAKU.center, b)).toBeLessThanOrEqual(3000 + 1);
      expect(b.trades).toEqual(['Santexnik']);
    }
    const ru = await t.client(token, 'ru').call(api.admin.demoState, {});
    expect(ru.bots[0]!.trades).toEqual(['Сантехник']);
  });

  it('spawns workers of an existing company (no own wallet, ACTIVE members)', async () => {
    const { token } = await adminToken(t);
    const company = await createCompany(t, { trades: ['electrical', 'plumbing'], workers: 0 });
    const plumbing = await categoryId(t, 'plumbing');
    const s = await t.client(token).call(api.admin.demoSpawnBots, {
      body: { count: 2, radiusKm: 1, center: BAKU.center, companyId: company.companyId, tradeIds: [plumbing] },
    });
    expect(s.bots).toHaveLength(2);
    for (const b of s.bots) {
      expect(b.companyName).toBe('FixPro MMC');
      expect(b.trades).toEqual(['Santexnik']);
      const p = await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: b.handymanId } });
      expect(p).toMatchObject({ isBot: true, kind: 'COMPANY_WORKER', companyId: company.companyId, status: 'APPROVED', walletAccountId: null, isOnline: true });
      const m = await t.prisma.companyMember.findUniqueOrThrow({ where: { companyId_userId: { companyId: company.companyId, userId: p.userId } } });
      expect(m).toMatchObject({ role: 'WORKER', status: 'ACTIVE' });
    }
    // Without tradeIds the workers get the company's trades.
    const all = await t.client(token).call(api.admin.demoSpawnBots, { body: { count: 1, companyId: company.companyId } });
    expect([...all.bots[2]!.trades].sort()).toEqual(['Elektrik', 'Santexnik']);
    await expectLedgerBalanced(t);
  });

  it('rejects bad spawn input', async () => {
    const { token } = await adminToken(t);
    const c = t.client(token);
    await expect(c.call(api.admin.demoSpawnBots, { body: { count: 0 } })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
    await expect(c.call(api.admin.demoSpawnBots, { body: { count: 51 } })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(c.call(api.admin.demoSpawnBots, { body: { count: 1, radiusKm: 25 } })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(c.call(api.admin.demoSpawnBots, { body: { count: 1, tradeIds: [crypto.randomUUID()] } })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { field: 'tradeIds' },
    });
    // A QUOTE-only group is not a service a bot can have.
    const group = await t.prisma.category.findFirstOrThrow({ where: { kind: 'GROUP' } });
    await expect(c.call(api.admin.demoSpawnBots, { body: { count: 1, tradeIds: [group.id] } })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(c.call(api.admin.demoSpawnBots, { body: { count: 1, companyId: crypto.randomUUID() } })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    const pending = await createCompany(t, { status: 'PENDING_REVIEW', workers: 0 });
    await expect(c.call(api.admin.demoSpawnBots, { body: { count: 1, companyId: pending.companyId } })).rejects.toMatchObject({
      code: 'COMPANY_NOT_APPROVED',
      status: 403,
    });
    const approved = await createCompany(t, { trades: ['electrical'], workers: 0 });
    await expect(
      c.call(api.admin.demoSpawnBots, { body: { count: 1, companyId: approved.companyId, tradeIds: [await categoryId(t, 'plumbing')] } }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await t.prisma.handymanProfile.count({ where: { isBot: true } })).toBe(0);
  });

  // ----------------------------------------------------------------- config

  it('updates the config partially, validates it and writes an audit row', async () => {
    const { token, adminId } = await adminToken(t);
    const c = t.client(token);
    const s = await c.call(api.admin.demoConfig, { body: { acceptDelaySec: 10, autoPrice: false, priceLabor: 5000 } });
    expect(s.config).toEqual({ ...DEFAULT_DEMO_CONFIG, acceptDelaySec: 10, autoPrice: false, priceLabor: 5000 });
    const again = await c.call(api.admin.demoConfig, { body: { speedKmh: 60 } });
    expect(again.config).toEqual({ ...DEFAULT_DEMO_CONFIG, acceptDelaySec: 10, autoPrice: false, priceLabor: 5000, speedKmh: 60 });
    expect((await c.call(api.admin.demoState, {})).config.speedKmh).toBe(60);
    const row = await t.prisma.platformSetting.findUniqueOrThrow({ where: { key: 'demo.config' } });
    expect(row.updatedByAdminId).toBe(adminId);
    const audits = await t.prisma.auditLog.findMany({ where: { action: 'demo.config' }, orderBy: { id: 'asc' } });
    expect(audits).toHaveLength(2);
    expect(audits[1]!.before).toMatchObject({ speedKmh: 40 });
    expect(audits[1]!.after).toMatchObject({ speedKmh: 60 });
    await expect(c.call(api.admin.demoConfig, { body: { acceptDelaySec: 0 } })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(c.call(api.admin.demoConfig, { body: { speedKmh: 1000 } })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(c.call(api.admin.demoConfig, { body: { priceLabor: -1 } })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  // ------------------------------------------------------------------ clear

  it('clears bots without deleting history: jobs cancelled via CancellationService and re-dispatched, offers declined, wallets returned', async () => {
    const { token, adminId } = await adminToken(t);
    const c = t.client(token);
    const plumbing = await categoryId(t, 'plumbing');
    const spawned = await c.call(api.admin.demoSpawnBots, { body: { count: 2, radiusKm: 0.3, center: BAKU.center, tradeIds: [plumbing] } });
    const [a, b] = await Promise.all(
      spawned.bots.map((x) => t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: x.handymanId } })),
    );
    const customer = await createCustomer(t, { balance: 5000 });
    const req1 = await t.client(customer.token).call(api.requests.create, {
      body: { categoryId: plumbing, description: 'Kran axır, təcili baxmaq lazımdır', timing: 'NOW', address: near(BAKU.center.lat, BAKU.center.lng) },
    });
    const offerA = await t.prisma.offer.findFirstOrThrow({ where: { requestId: req1.id, handymanId: a!.id, status: 'SENT' } });
    const { assignment } = await t.app.get(OffersService).acceptSolo(a!.userId, offerA.id, 'az');
    expect((await t.ledger.balance(a!.walletAccountId!)).held).toBe(1000);
    // A second request now only reaches bot B (A is busy): its offer stays SENT.
    const req2 = await t.client(customer.token).call(api.requests.create, {
      body: { categoryId: plumbing, description: 'Unitazın çəni dolmur', timing: 'NOW', address: near(BAKU.center.lat, BAKU.center.lng) },
    });
    const offerB = await t.prisma.offer.findFirstOrThrow({ where: { requestId: req2.id, handymanId: b!.id, status: 'SENT' } });

    const after = await c.call(api.admin.demoClearBots, {});
    expect(after.bots).toEqual([]);

    // A's job: ADMIN cancellation (free, hold released, no penalty), slot re-opened and the request searching again.
    const cancelled = await t.prisma.assignment.findUniqueOrThrow({ where: { id: assignment.id } });
    expect(cancelled.status).toBe('CANCELLED_FREE');
    expect(cancelled.cancelledBy).toBe('ADMIN');
    expect(cancelled.cancelReason).toBe('Demo usta silindi, sifariş başqa ustaya göndərilir');
    const r1 = await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: req1.id }, include: { slots: true } });
    expect(r1.status).toBe('SEARCHING');
    expect(r1.slots[0]!.status).toBe('OPEN');
    expect(await t.ledger.balance(customer.walletAccountId)).toMatchObject({ posted: 5000, held: 0 });
    // B's offer was declined.
    expect((await t.prisma.offer.findUniqueOrThrow({ where: { id: offerB.id } })).status).toBe('DECLINED');

    for (const p of [a!, b!]) {
      const fresh = await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: p.id }, include: { user: true } });
      expect(fresh.isOnline).toBe(false);
      expect(fresh.user.status).toBe('DELETED');
      expect(fresh.isBot).toBe(true); // kept: the ledger and the job history still point at it
      expect(await t.ledger.balance(p.walletAccountId!)).toEqual({ posted: 0, held: 0, available: 0 });
      const defund = await t.prisma.ledgerTransaction.findUniqueOrThrow({ where: { idempotencyKey: `demo-bot-defund:${p.id}` } });
      expect(defund.kind).toBe('ADMIN_ADJUSTMENT');
    }
    expect(await t.prisma.offer.count({ where: { handymanId: { in: [a!.id, b!.id] }, status: 'SENT' } })).toBe(0);
    const audit = await t.prisma.auditLog.findFirstOrThrow({ where: { action: 'demo.clearBots' } });
    expect(audit).toMatchObject({ actorType: 'ADMIN', actorId: adminId });
    expect(audit.after).toMatchObject({ cancelledAssignments: [assignment.id] });

    // Clearing again changes nothing.
    expect((await c.call(api.admin.demoClearBots, {})).bots).toEqual([]);
    expect(await t.prisma.auditLog.count({ where: { action: 'demo.clearBots' } })).toBe(2);
    await expectLedgerBalanced(t);
  });

  it('clears company bots: membership removed, the company keeps its money', async () => {
    const { token } = await adminToken(t);
    const company = await createCompany(t, { trades: ['plumbing'], workers: 0, balance: 5000 });
    await t.client(token).call(api.admin.demoSpawnBots, { body: { count: 1, companyId: company.companyId } });
    const bot = await t.prisma.handymanProfile.findFirstOrThrow({ where: { isBot: true } });
    await t.client(token).call(api.admin.demoClearBots, {});
    const m = await t.prisma.companyMember.findUniqueOrThrow({ where: { companyId_userId: { companyId: company.companyId, userId: bot.userId } } });
    expect(m.status).toBe('REMOVED');
    expect(await t.ledger.balance(company.walletAccountId)).toMatchObject({ posted: 5000 });
    await expectLedgerBalanced(t);
  });

  // --------------------------------------------------------------- requests

  it('creates a test request as the demo customer (created and funded once) and dispatches it to bots', async () => {
    const { token, adminId } = await adminToken(t);
    const c = t.client(token);
    const plumbing = await categoryId(t, 'plumbing');
    await c.call(api.admin.demoSpawnBots, { body: { count: 1, radiusKm: 0.3, center: BAKU.center, tradeIds: [plumbing] } });
    const out = await c.call(api.admin.demoCreateRequest, { body: { categoryId: plumbing, lat: BAKU.center.lat, lng: BAKU.center.lng } });
    expect(out.number).toBeGreaterThanOrEqual(1000);
    const r = await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: out.requestId }, include: { customerAccount: { include: { owner: true } } } });
    expect(r.customerAccount.owner.phone).toBe(DEMO_CUSTOMER.phone);
    expect(r.customerAccount.owner.firstName).toBe('Demo');
    expect(r).toMatchObject({ timing: 'NOW', slotsRequested: 1, status: 'SEARCHING', description: 'Demo sifariş: test üçün yaradılıb' });
    expect(r.formatted.length).toBeGreaterThan(0);
    expect(await t.prisma.offer.count({ where: { requestId: r.id, handyman: { isBot: true } } })).toBe(1);
    const wallet = await t.ledger.balance(r.customerAccount.walletAccountId);
    expect(wallet.posted).toBe(10_000);

    // A second request reuses the customer; the wallet is not topped up again.
    const out2 = await c.call(api.admin.demoCreateRequest, {
      body: { categoryId: plumbing, lat: BAKU.narimanov.lat, lng: BAKU.narimanov.lng, timing: 'EMERGENCY', slots: 2, description: 'Təcili demo sifariş' },
    });
    const r2 = await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: out2.requestId } });
    expect(r2).toMatchObject({ customerAccountId: r.customerAccountId, timing: 'EMERGENCY', slotsRequested: 2, description: 'Təcili demo sifariş' });
    expect(await t.ledger.balance(r.customerAccount.walletAccountId)).toEqual({ posted: 10_000, held: 1000, available: 9000 });
    expect(await t.prisma.user.count({ where: { phone: DEMO_CUSTOMER.phone } })).toBe(1);
    expect(await t.prisma.auditLog.count({ where: { action: 'demo.createRequest', actorId: adminId } })).toBe(2);
    await expectLedgerBalanced(t);
  });

  it('creates a request for a given customer and reports the usual errors', async () => {
    const { token } = await adminToken(t);
    const c = t.client(token);
    const plumbing = await categoryId(t, 'plumbing');
    const customer = await createCustomer(t, { balance: 0 });
    const out = await c.call(api.admin.demoCreateRequest, {
      body: { customerUserId: customer.userId, categoryId: plumbing, lat: BAKU.ahmadli.lat, lng: BAKU.ahmadli.lng, description: 'Hamamda boru sızır' },
    });
    const r = await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: out.requestId } });
    expect(r.customerAccountId).toBe(customer.accountId);
    expect(r.createdByUserId).toBe(customer.userId);

    await expect(
      c.call(api.admin.demoCreateRequest, { body: { customerUserId: crypto.randomUUID(), categoryId: plumbing, lat: 40.4, lng: 49.9 } }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    const noAccount = await createUser(t);
    await expect(
      c.call(api.admin.demoCreateRequest, { body: { customerUserId: noAccount.userId, categoryId: plumbing, lat: 40.4, lng: 49.9 } }),
    ).rejects.toMatchObject({ code: 'CUSTOMER_ACCOUNT_REQUIRED' });
    await expect(
      c.call(api.admin.demoCreateRequest, { body: { categoryId: plumbing, lat: 40.4, lng: 49.9, timing: 'SCHEDULED' } }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
    await expect(
      c.call(api.admin.demoCreateRequest, { body: { categoryId: crypto.randomUUID(), lat: 40.4, lng: 49.9 } }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const quoteOnly = await categoryId(t, 'renovation-crew');
    await expect(c.call(api.admin.demoCreateRequest, { body: { categoryId: quoteOnly, lat: 40.4, lng: 49.9 } })).rejects.toMatchObject({
      code: 'CATEGORY_REQUIRES_QUOTE',
    });
    await expect(c.call(api.admin.demoCreateRequest, { body: { categoryId: plumbing, lat: 91, lng: 49.9 } })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });
});
