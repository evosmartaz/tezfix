import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api } from '@tezfiks/shared';
import { createTestApp, type TestApp } from '../helpers/app';
import {
  adminToken,
  createCompany,
  createCustomer,
  createSoloHandyman,
  createUser,
  fund,
  tokenFor,
} from '../helpers/factories';
import { WalletEventsService } from '../../src/modules/wallet/wallet-events.service';
import { WalletAccessService } from '../../src/modules/wallet/wallet-access.service';
import { createRequestRow, expectLedgerClean } from './helpers';

describe('A2 wallets', () => {
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
  afterEach(async () => {
    await expectLedgerClean(t);
  });

  describe('GET /wallet resolution', () => {
    it('customer app returns the customer wallet', async () => {
      const c = await createCustomer(t, { balance: 5000 });
      const w = await t.client(c.token).call(api.wallet.get);
      expect(w).toEqual({
        accountId: c.walletAccountId,
        currency: 'AZN',
        posted: 5000,
        held: 0,
        available: 5000,
        isDebt: false,
        lowBalance: false,
      });
    });

    it('pro app returns the solo handyman wallet; owner=customer switches to the customer wallet', async () => {
      const h = await createSoloHandyman(t, { balance: 3000 });
      const w = await t.client(h.token).call(api.wallet.get);
      expect(w.accountId).toBe(h.walletAccountId);
      expect(w.available).toBe(3000);

      // the same user without a customer account asks for owner=customer
      await expect(
        t.client(h.token).call(api.wallet.get, { query: { owner: 'customer' } }),
      ).rejects.toMatchObject({
        code: 'CUSTOMER_ACCOUNT_REQUIRED',
        status: 409,
      });
      // give the handyman user a customer account and ask again
      const custAccountId = crypto.randomUUID();
      const custWallet = await t.ledger.ensureAccount('CUSTOMER_ACCOUNT', custAccountId, 'WALLET');
      await t.prisma.customerAccount.create({
        data: { id: custAccountId, ownerUserId: h.userId, walletAccountId: custWallet.id },
      });
      await fund(t, custWallet.id, 1200);
      const cw = await t.client(h.token).call(api.wallet.get, { query: { owner: 'customer' } });
      expect(cw).toMatchObject({ accountId: custWallet.id, posted: 1200, available: 1200 });
    });

    it('customer app with owner=handyman returns the handyman wallet', async () => {
      const h = await createSoloHandyman(t, { balance: 2500 });
      const customerAppToken = await tokenFor(t, h.userId, 'CUSTOMER');
      const w = await t.client(customerAppToken).call(api.wallet.get, { query: { owner: 'handyman' } });
      expect(w.accountId).toBe(h.walletAccountId);
    });

    it('panel session defaults to the customer wallet', async () => {
      const c = await createCustomer(t, { balance: 700 });
      const panel = await tokenFor(t, c.userId, 'PANEL');
      const w = await t.client(panel).call(api.wallet.get);
      expect(w.accountId).toBe(c.walletAccountId);
      expect(w.lowBalance).toBe(true); // 700 < lowBalanceThreshold (1000)
    });

    it('customer app without a customer account -> CUSTOMER_ACCOUNT_REQUIRED', async () => {
      const u = await createUser(t);
      const token = await tokenFor(t, u.userId, 'CUSTOMER');
      await expect(t.client(token).call(api.wallet.get)).rejects.toMatchObject({
        code: 'CUSTOMER_ACCOUNT_REQUIRED',
        status: 409,
      });
    });

    it('pro app: company worker -> FORBIDDEN, no handyman profile -> NOT_FOUND', async () => {
      const co = await createCompany(t, { workers: 1 });
      await expect(t.client(co.workers[0]!.token).call(api.wallet.get)).rejects.toMatchObject({
        code: 'FORBIDDEN',
        status: 403,
      });
      await expect(t.client(co.workers[0]!.token).call(api.wallet.transactions)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      const u = await createUser(t);
      const token = await tokenFor(t, u.userId, 'PRO');
      await expect(t.client(token).call(api.wallet.get)).rejects.toMatchObject({
        code: 'NOT_FOUND',
        status: 404,
      });
    });

    it('creates missing handyman wallet/earnings accounts on first use', async () => {
      const u = await createUser(t, { firstName: 'Əli', lastName: 'Qasımov' });
      const profile = await t.prisma.handymanProfile.create({
        data: { userId: u.userId, kind: 'SOLO', status: 'DRAFT' },
      });
      const token = await tokenFor(t, u.userId, 'PRO');
      const w = await t.client(token).call(api.wallet.get);
      const after = await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: profile.id } });
      expect(after.walletAccountId).toBe(w.accountId);
      expect(after.earningsAccountId).toBeTruthy();
      expect(w).toMatchObject({ posted: 0, held: 0, available: 0, isDebt: false, lowBalance: true });
    });

    it('requires a user token: no token -> UNAUTHORIZED, admin token -> FORBIDDEN', async () => {
      await expect(t.client(null).call(api.wallet.get)).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
        status: 401,
      });
      const admin = await adminToken(t);
      await expect(t.client(admin.token).call(api.wallet.get)).rejects.toMatchObject({
        code: 'FORBIDDEN',
        status: 403,
      });
    });
  });

  it('reports debt (negative posted balance after a penalty) and holds', async () => {
    const c = await createCustomer(t, { balance: 1000 });
    const revenue = await t.ledger.platformAccountId('REVENUE');
    await t.ledger.post({
      kind: 'CANCEL_PENALTY',
      idempotencyKey: 'penalty:test',
      entries: [
        { accountId: c.walletAccountId, amount: -1500 },
        { accountId: revenue, amount: 1500 },
      ],
      allowOverdraft: [c.walletAccountId],
    });
    const w = await t.client(c.token).call(api.wallet.get);
    expect(w).toMatchObject({ posted: -500, held: 0, available: -500, isDebt: true, lowBalance: true });

    const h = await createSoloHandyman(t, { balance: 3000 });
    await t.ledger.hold({ accountId: h.walletAccountId!, amount: 1000, kind: 'REQUEST_FEE' });
    const hw = await t.client(h.token).call(api.wallet.get);
    expect(hw).toMatchObject({ posted: 3000, held: 1000, available: 2000, isDebt: false, lowBalance: false });
  });

  it('lists wallet transactions newest first with cursor paging and request numbers', async () => {
    const c = await createCustomer(t);
    const { request } = await createRequestRow(t, c);
    const external = await t.ledger.platformAccountId('EXTERNAL');
    const revenue = await t.ledger.platformAccountId('REVENUE');
    for (let i = 1; i <= 5; i++) {
      await t.ledger.post({
        kind: 'TOPUP',
        idempotencyKey: `topup:${i}`,
        entries: [
          { accountId: external, amount: -100 * i },
          { accountId: c.walletAccountId, amount: 100 * i },
        ],
      });
    }
    await t.ledger.post({
      kind: 'EMERGENCY_FEE_CAPTURE',
      idempotencyKey: 'em:1',
      entries: [
        { accountId: c.walletAccountId, amount: -500 },
        { accountId: revenue, amount: 500 },
      ],
      refs: { requestId: request.id },
    });
    const client = t.client(c.token);
    const page1 = await client.call(api.wallet.transactions, { query: { limit: 4 } });
    expect(page1.items).toHaveLength(4);
    expect(page1.items[0]).toMatchObject({
      kind: 'EMERGENCY_FEE_CAPTURE',
      amount: -500,
      balanceAfter: 1000,
      requestNumber: request.number,
    });
    expect(page1.items[1]).toMatchObject({
      kind: 'TOPUP',
      amount: 500,
      balanceAfter: 1500,
      requestNumber: null,
      projectNumber: null,
    });
    expect(page1.nextCursor).toBeTruthy();
    const page2 = await client.call(api.wallet.transactions, {
      query: { limit: 4, cursor: page1.nextCursor! },
    });
    expect(page2.items.map((i) => i.amount)).toEqual([200, 100]);
    expect(page2.nextCursor).toBeNull();
    // other users never see these entries
    const other = await createCustomer(t);
    expect((await t.client(other.token).call(api.wallet.transactions)).items).toEqual([]);
  });

  describe('company wallet', () => {
    it('is readable by an ACTIVE manager only', async () => {
      const co = await createCompany(t, { workers: 1, balance: 9000 });
      const w = await t
        .client(co.manager.token)
        .call(api.company.wallet, { params: { companyId: co.companyId } });
      expect(w).toMatchObject({ accountId: co.walletAccountId, posted: 9000, available: 9000 });
      const tx = await t
        .client(co.manager.token)
        .call(api.company.walletTransactions, { params: { companyId: co.companyId } });
      expect(tx.items).toHaveLength(1);
      expect(tx.items[0]).toMatchObject({ kind: 'TOPUP', amount: 9000 });

      // a worker of the company
      await expect(
        t.client(co.workers[0]!.token).call(api.company.wallet, { params: { companyId: co.companyId } }),
      ).rejects.toMatchObject({
        code: 'NOT_COMPANY_MANAGER',
        status: 403,
      });
      // the manager of another company
      const other = await createCompany(t, { workers: 0 });
      await expect(
        t.client(other.manager.token).call(api.company.wallet, { params: { companyId: co.companyId } }),
      ).rejects.toMatchObject({
        code: 'NOT_COMPANY_MANAGER',
      });
      await expect(
        t
          .client(other.manager.token)
          .call(api.company.walletTransactions, { params: { companyId: co.companyId } }),
      ).rejects.toMatchObject({ code: 'NOT_COMPANY_MANAGER' });
      // unknown company
      await expect(
        t.client(co.manager.token).call(api.company.wallet, { params: { companyId: crypto.randomUUID() } }),
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
        status: 404,
      });
      // a removed manager loses access
      await t.prisma.companyMember.update({
        where: { companyId_userId: { companyId: co.companyId, userId: co.manager.userId } },
        data: { status: 'REMOVED', removedAt: t.clock.now() },
      });
      await expect(
        t.client(co.manager.token).call(api.company.wallet, { params: { companyId: co.companyId } }),
      ).rejects.toMatchObject({
        code: 'NOT_COMPANY_MANAGER',
      });
    });
  });

  describe('WalletEventsService.notifyAccount', () => {
    it('emits wallet:updated to the customer, the solo handyman and the company room', async () => {
      const events = t.app.get(WalletEventsService);
      const c = await createCustomer(t, { balance: 1500 });
      const h = await createSoloHandyman(t, { balance: 2000 });
      const co = await createCompany(t, { balance: 4000 });
      await t.ledger.hold({ accountId: h.walletAccountId!, amount: 1000, kind: 'REQUEST_FEE' });
      await events.notifyAccount(c.walletAccountId);
      await events.notifyAccount(h.walletAccountId!);
      await events.notifyAccount(co.walletAccountId);
      await events.notifyAccount(h.earningsAccountId!); // earnings accounts are ignored
      expect(t.realtime.sentTo(`user:${c.userId}`, 'wallet:updated').map((e) => e.payload)).toEqual([
        { owner: 'customer', companyId: null, available: 1500, posted: 1500 },
      ]);
      expect(t.realtime.sentTo(`user:${h.userId}`, 'wallet:updated').map((e) => e.payload)).toEqual([
        { owner: 'handyman', companyId: null, available: 1000, posted: 2000 },
      ]);
      expect(t.realtime.sentTo(`company:${co.companyId}`, 'wallet:updated').map((e) => e.payload)).toEqual([
        { owner: 'company', companyId: co.companyId, available: 4000, posted: 4000 },
      ]);
      // unknown account: silently ignored
      await events.notifyAccount(crypto.randomUUID());
    });
  });

  it('WalletAccessService.defaultOwner maps apps to owners', () => {
    expect(WalletAccessService.defaultOwner('PRO')).toBe('handyman');
    expect(WalletAccessService.defaultOwner('CUSTOMER')).toBe('customer');
    expect(WalletAccessService.defaultOwner('PANEL')).toBe('customer');
  });
});
