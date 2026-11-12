import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api } from '@tezfiks/shared';
import { createTestApp, type TestApp } from '../helpers/app';
import { adminToken, createCompany, createCustomer, createSoloHandyman } from '../helpers/factories';
import { LedgerIntegrityService } from '../../src/modules/wallet/ledger-integrity.service';
import { WalletAdminService } from '../../src/modules/wallet/wallet-admin.service';
import { createRequestRow, expectLedgerClean } from './helpers';
import { ENV, loadEnv } from '../../src/config/env';

describe('A2 admin wallet adjustments, ledger explorer and integrity check', () => {
  let t: TestApp;
  beforeAll(async () => {
    // Admin balance adjustments are demo-only (spec: "Demo only: admins can top up balances"); outside the demo they answer
    // DEMO_DISABLED (test/a2/production-guards.spec.ts).
    t = await createTestApp((b) => b.overrideProvider(ENV).useValue({ ...loadEnv(), DEMO_MODE: true }));
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
  });
  afterEach(async () => {
    await expectLedgerClean(t);
  });

  describe('adjustWallet', () => {
    it('credits a customer wallet from ADJUSTMENTS, writes an audit row and returns the new summary', async () => {
      const c = await createCustomer(t, { balance: 1000 });
      const admin = await adminToken(t);
      const out = await t.client(admin.token).call(api.admin.adjustWallet, {
        body: {
          owner: { type: 'CUSTOMER_ACCOUNT', id: c.accountId },
          amount: 2500,
          reason: 'Kompensasiya: gecikmə',
        },
      });
      expect(out.wallet).toMatchObject({
        accountId: c.walletAccountId,
        posted: 3500,
        available: 3500,
        isDebt: false,
      });
      const tx = await t.prisma.ledgerTransaction.findUniqueOrThrow({
        where: { id: out.transactionId },
        include: { entries: true },
      });
      expect(tx).toMatchObject({
        kind: 'ADMIN_ADJUSTMENT',
        memo: 'Kompensasiya: gecikmə',
        actorType: 'ADMIN',
        actorId: admin.adminId,
      });
      const adjustments = await t.ledger.platformAccountId('ADJUSTMENTS');
      expect(tx.entries.map((e) => [e.accountId, Number(e.amount)]).sort()).toEqual(
        [
          [adjustments, -2500],
          [c.walletAccountId, 2500],
        ].sort(),
      );
      const audit = await t.prisma.auditLog.findFirstOrThrow({ where: { action: 'wallet.adjust' } });
      expect(audit).toMatchObject({
        actorType: 'ADMIN',
        actorId: admin.adminId,
        entityType: 'LedgerAccount',
        entityId: c.walletAccountId,
      });
      expect(audit.before).toMatchObject({ posted: 1000 });
      expect(audit.after).toMatchObject({
        posted: 3500,
        amount: 2500,
        reason: 'Kompensasiya: gecikmə',
        transactionId: out.transactionId,
      });
      expect(t.realtime.sentTo(`user:${c.userId}`, 'wallet:updated').map((e) => e.payload)).toEqual([
        { owner: 'customer', companyId: null, available: 3500, posted: 3500 },
      ]);
    });

    it('negative amounts may not overdraw a non-negative account (INSUFFICIENT_BALANCE), nothing is written', async () => {
      const h = await createSoloHandyman(t, { balance: 1000 });
      const admin = await adminToken(t);
      const ac = t.client(admin.token);
      await expect(
        ac.call(api.admin.adjustWallet, {
          body: { owner: { type: 'HANDYMAN', id: h.handymanId }, amount: -1500, reason: 'Səhv köçürmə' },
        }),
      ).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE', status: 402 });
      expect(await t.prisma.auditLog.count({ where: { action: 'wallet.adjust' } })).toBe(0);
      expect((await t.ledger.balance(h.walletAccountId!)).posted).toBe(1000);
      // holds count: available = 1000 - 600 = 400
      await t.ledger.hold({ accountId: h.walletAccountId!, amount: 600, kind: 'REQUEST_FEE' });
      await expect(
        ac.call(api.admin.adjustWallet, {
          body: { owner: { type: 'HANDYMAN', id: h.handymanId }, amount: -500, reason: 'Səhv köçürmə' },
        }),
      ).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
      const ok = await ac.call(api.admin.adjustWallet, {
        body: { owner: { type: 'HANDYMAN', id: h.handymanId }, amount: -400, reason: 'Səhv köçürmə' },
      });
      expect(ok.wallet).toMatchObject({ posted: 600, held: 600, available: 0 });
    });

    it('adjusts EARNINGS and company wallets; unknown owners -> NOT_FOUND; validation and admin-only', async () => {
      const h = await createSoloHandyman(t);
      const co = await createCompany(t, { workers: 1 });
      const admin = await adminToken(t);
      const ac = t.client(admin.token);
      const e = await ac.call(api.admin.adjustWallet, {
        body: {
          owner: { type: 'HANDYMAN', id: h.handymanId },
          account: 'EARNINGS',
          amount: 700,
          reason: 'Nağdsız ödəniş düzəlişi',
        },
      });
      expect(e.wallet).toMatchObject({ accountId: h.earningsAccountId, posted: 700 });
      const cw = await ac.call(api.admin.adjustWallet, {
        body: { owner: { type: 'COMPANY', id: co.companyId }, amount: 10_000, reason: 'Bonus' },
      });
      expect(cw.wallet).toMatchObject({ accountId: co.walletAccountId, posted: 10_000 });
      expect(t.realtime.sentTo(`company:${co.companyId}`, 'wallet:updated')).toHaveLength(1);
      // company workers have no accounts
      await expect(
        ac.call(api.admin.adjustWallet, {
          body: { owner: { type: 'HANDYMAN', id: co.workers[0]!.handymanId }, amount: 100, reason: 'Test' },
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
      await expect(
        ac.call(api.admin.adjustWallet, {
          body: { owner: { type: 'CUSTOMER_ACCOUNT', id: crypto.randomUUID() }, amount: 100, reason: 'Test' },
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        ac.call(api.admin.adjustWallet, {
          body: { owner: { type: 'COMPANY', id: co.companyId }, amount: 0, reason: 'Test' },
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      await expect(
        t
          .client(co.manager.token)
          .call(api.admin.adjustWallet, {
            body: { owner: { type: 'COMPANY', id: co.companyId }, amount: 100, reason: 'Test' },
          }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('is idempotent per Idempotency-Key (a double click posts once)', async () => {
      const c = await createCustomer(t);
      const admin = await adminToken(t);
      const ac = t.client(admin.token);
      const body = {
        owner: { type: 'CUSTOMER_ACCOUNT' as const, id: c.accountId },
        amount: 1000,
        reason: 'Promo',
      };
      const a = await ac.call(api.admin.adjustWallet, { body, idempotencyKey: 'adj-1' });
      const b = await ac.call(api.admin.adjustWallet, { body, idempotencyKey: 'adj-1' });
      expect(b.transactionId).toBe(a.transactionId);
      expect((await t.ledger.balance(c.walletAccountId)).posted).toBe(1000);
    });
  });

  describe('ledger explorer', () => {
    it('lists transactions with entries and owner names; filters by kind and owner; pages', async () => {
      const c = await createCustomer(t, { firstName: 'Səbinə', lastName: 'Əhmədova', balance: 3000 });
      const h = await createSoloHandyman(t, { firstName: 'İlqar', lastName: 'Çələbiyev', balance: 5000 });
      const co = await createCompany(t, { name: 'Ağ Şəhər Təmir MMC', balance: 8000 });
      const { request } = await createRequestRow(t, c);
      const revenue = await t.ledger.platformAccountId('REVENUE');
      await t.ledger.post({
        kind: 'REQUEST_FEE_CAPTURE',
        idempotencyKey: `fee-capture:test`,
        entries: [
          { accountId: h.walletAccountId!, amount: -1000 },
          { accountId: revenue, amount: 1000 },
        ],
        refs: { requestId: request.id },
      });
      const admin = await adminToken(t);
      const ac = t.client(admin.token);

      const all = await ac.call(api.admin.ledger);
      expect(all.items.map((i) => i.kind)).toEqual(['REQUEST_FEE_CAPTURE', 'TOPUP', 'TOPUP', 'TOPUP']);
      const fee = all.items[0]!;
      expect(fee.requestNumber).toBe(request.number);
      expect(fee.actor).toBeNull();
      expect(fee.entries).toEqual([
        {
          accountId: h.walletAccountId,
          ownerType: 'HANDYMAN',
          ownerId: h.handymanId,
          ownerName: 'İlqar Çələbiyev',
          accountKind: 'WALLET',
          amount: -1000,
          balanceAfter: 4000,
        },
        {
          accountId: revenue,
          ownerType: 'PLATFORM',
          ownerId: null,
          ownerName: 'TezFiks: REVENUE',
          accountKind: 'REVENUE',
          amount: 1000,
          balanceAfter: 1000,
        },
      ]);
      const names = all.items.flatMap((i) => i.entries.map((e) => e.ownerName));
      expect(names).toContain('Səbinə Əhmədova');
      expect(names).toContain('Ağ Şəhər Təmir MMC');
      expect(names).toContain('TezFiks: EXTERNAL');

      const fees = await ac.call(api.admin.ledger, { query: { kind: 'REQUEST_FEE_CAPTURE' } });
      expect(fees.items.map((i) => i.id)).toEqual([fee.id]);
      const companyTx = await ac.call(api.admin.ledger, {
        query: { ownerType: 'COMPANY', ownerId: co.companyId },
      });
      expect(companyTx.items).toHaveLength(1);
      expect(companyTx.items[0]!.entries.find((e) => e.ownerType === 'COMPANY')).toMatchObject({
        ownerName: 'Ağ Şəhər Təmir MMC',
        amount: 8000,
      });
      const handymanTx = await ac.call(api.admin.ledger, { query: { ownerId: h.handymanId } });
      expect(handymanTx.items.map((i) => i.kind)).toEqual(['REQUEST_FEE_CAPTURE', 'TOPUP']);
      const customers = await ac.call(api.admin.ledger, { query: { ownerType: 'CUSTOMER_ACCOUNT' } });
      expect(customers.items).toHaveLength(1);

      const p1 = await ac.call(api.admin.ledger, { query: { limit: 3 } });
      expect(p1.items).toHaveLength(3);
      const p2 = await ac.call(api.admin.ledger, { query: { limit: 3, cursor: p1.nextCursor! } });
      expect(p2.items).toHaveLength(1);
      expect(p2.nextCursor).toBeNull();
      await expect(ac.call(api.admin.ledger, { query: { cursor: 'not-a-uuid' } })).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
      await expect(t.client(c.token).call(api.admin.ledger)).rejects.toMatchObject({ code: 'FORBIDDEN' });

      // admin actor names are shown for adjustments
      await ac.call(api.admin.adjustWallet, {
        body: { owner: { type: 'CUSTOMER_ACCOUNT', id: c.accountId }, amount: 100, reason: 'Test' },
      });
      const adj = await ac.call(api.admin.ledger, { query: { kind: 'ADMIN_ADJUSTMENT' } });
      expect(adj.items[0]).toMatchObject({ actor: 'Test Admin', memo: 'Test' });
      expect(adj.items[0]!.entries.map((e) => e.ownerName).sort()).toEqual([
        'Səbinə Əhmədova',
        'TezFiks: ADJUSTMENTS',
      ]);

      // WalletAdminService.forRequest (used by the admin request detail)
      const forRequest = await t.app.get(WalletAdminService).forRequest(request.id);
      expect(forRequest.map((r) => r.id)).toEqual([fee.id]);
    });
  });

  describe('ledger.integrity reconciler task', () => {
    it('detects and logs mismatches; runs at most once per Baku day', async () => {
      const integrity = t.app.get(LedgerIntegrityService);
      const c = await createCustomer(t, { balance: 1000 });
      expect(await integrity.checkNow()).toEqual([]);

      // simulate a corrupted cached balance
      await t.prisma.ledgerAccount.update({
        where: { id: c.walletAccountId },
        data: { postedBalance: 999n },
      });
      const mismatches = await integrity.checkNow();
      expect(mismatches).toEqual([
        { accountId: c.walletAccountId, posted: 999, computedPosted: 1000, held: 0, computedHeld: 0 },
      ]);

      t.clock.set('2026-10-28T08:00:00Z'); // 12:00 Baku
      expect(await integrity.runDaily()).toEqual(mismatches);
      expect(await integrity.runDaily()).toBeNull(); // already ran today
      await t.reconciler.tickAll(); // registered task does not throw
      t.clock.set('2026-10-28T22:30:00Z'); // 02:30 Baku next day: too early
      expect(await integrity.runDaily()).toBeNull();
      t.clock.set('2026-10-29T00:30:00Z'); // 04:30 Baku
      expect(await integrity.runDaily()).toHaveLength(1);

      // repair so the global invariant check passes
      await t.prisma.ledgerAccount.update({
        where: { id: c.walletAccountId },
        data: { postedBalance: 1000n },
      });
    });
  });
});
