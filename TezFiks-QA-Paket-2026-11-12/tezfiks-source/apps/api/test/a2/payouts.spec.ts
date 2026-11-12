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
import { luhnValid, maskPayoutNumber } from '../../src/modules/payouts/payout-method';
import {
  PAYOUTS_WEEKLY_JOB,
  PayoutsService,
  startOfBakuWeek,
} from '../../src/modules/payouts/payouts.service';
import { createCompletedAssignment, expectLedgerClean } from './helpers';

/** Wednesday 2026-10-28 12:00 Baku (ISO week 2026-W44; the Baku week started Monday 2026-10-26 00:00 = 2026-10-25T20:00Z). */
const WEDNESDAY = '2026-10-28T08:00:00.000Z';
const WEEK_START = '2026-10-25T20:00:00.000Z';
const PREV_WEEK_START = '2026-10-18T20:00:00.000Z';

function withLuhnDigit(prefix: string): string {
  for (let d = 0; d <= 9; d++) if (luhnValid(`${prefix}${d}`)) return `${prefix}${d}`;
  throw new Error('unreachable');
}

describe('A2 earnings, payout methods and payouts', () => {
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

  async function credit(
    accountId: string,
    amount: number,
    kind: 'JOB_PAYMENT' | 'TIP' | 'INVOICE_PAYMENT' = 'JOB_PAYMENT',
  ) {
    const external = await t.ledger.platformAccountId('EXTERNAL');
    await t.ledger.post({
      kind,
      idempotencyKey: `test-credit:${accountId}:${Math.random()}`,
      entries: [
        { accountId: external, amount: -amount },
        { accountId, amount },
      ],
    });
  }

  describe('payout method validation and masking', () => {
    it('masks cards and IBANs and rejects invalid numbers', () => {
      expect(luhnValid('79927398713')).toBe(true);
      expect(luhnValid('79927398710')).toBe(false);
      expect(maskPayoutNumber('CARD', '4242 4242 4242 4242')).toBe('•••• 4242');
      expect(maskPayoutNumber('CARD', '4242-4242-4242-4242')).toBe('•••• 4242');
      expect(maskPayoutNumber('CARD', '4242 4242 4242 4241')).toBeNull(); // Luhn
      expect(maskPayoutNumber('CARD', '378282246310005')).toBeNull(); // 15 digits
      const nineteen = withLuhnDigit('411111111111111111');
      expect(nineteen).toHaveLength(19);
      expect(maskPayoutNumber('CARD', nineteen)).toBe(`•••• ${nineteen.slice(-4)}`);
      expect(maskPayoutNumber('CARD', withLuhnDigit('4111111111111111111'))).toBeNull(); // 20 digits
      expect(maskPayoutNumber('IBAN', 'AZ21NABZ00000000137010001944')).toBe('AZ21 •••• 1944');
      expect(maskPayoutNumber('IBAN', 'az21 nabz 0000 0000 1370 1000 1944')).toBe('AZ21 •••• 1944');
      expect(maskPayoutNumber('IBAN', 'AZ21NABZ0000000013701000194')).toBeNull(); // too short
      expect(maskPayoutNumber('IBAN', 'AZ2XNABZ00000000137010001944')).toBeNull();
      expect(maskPayoutNumber('IBAN', 'GB29NWBK60161331926819')).toBeNull();
      expect(maskPayoutNumber('CARD', 'AZ21NABZ00000000137010001944')).toBeNull();
      expect(maskPayoutNumber('IBAN', '4242424242424242')).toBeNull();
    });

    it('pro app: set and get the payout card; only the masked copy is stored', async () => {
      const h = await createSoloHandyman(t);
      const client = t.client(h.token);
      expect(await client.call(api.pro.getPayoutMethod)).toEqual({ method: null });
      const set = await client.call(api.pro.setPayoutMethod, {
        body: { type: 'CARD', number: '4242 4242 4242 4242', holderName: 'Elvin Məmmədov' },
      });
      expect(set).toMatchObject({ type: 'CARD', maskedNumber: '•••• 4242', holderName: 'Elvin Məmmədov' });
      expect((await client.call(api.pro.getPayoutMethod)).method).toEqual(set);
      const row = await t.prisma.payoutMethod.findUniqueOrThrow({ where: { handymanId: h.handymanId } });
      expect(JSON.stringify(row)).not.toContain('4242424242424242');
      expect(JSON.stringify(row)).not.toContain('4242 4242 4242 4242');

      // switching to an IBAN replaces the method
      const iban = await client.call(api.pro.setPayoutMethod, {
        body: { type: 'IBAN', number: 'AZ21 NABZ 0000 0000 1370 1000 1944', holderName: 'Elvin Məmmədov' },
      });
      expect(iban.maskedNumber).toBe('AZ21 •••• 1944');
      expect(await t.prisma.payoutMethod.count()).toBe(1);

      await expect(
        client.call(api.pro.setPayoutMethod, {
          body: { type: 'CARD', number: '4242 4242 4242 4241', holderName: 'Elvin Məmmədov' },
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
      await expect(
        client.call(api.pro.setPayoutMethod, {
          body: { type: 'IBAN', number: 'AZ21NABZ000000001370', holderName: 'Elvin Məmmədov' },
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      await expect(
        client.call(api.pro.setPayoutMethod, { body: { type: 'CARD', number: '4242', holderName: 'Elvin' } }),
      ).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
      // the last valid method is unchanged
      expect((await client.call(api.pro.getPayoutMethod)).method?.maskedNumber).toBe('AZ21 •••• 1944');
    });

    it('pro endpoints: company workers FORBIDDEN, users without a profile NOT_FOUND', async () => {
      const co = await createCompany(t, { workers: 1 });
      const w = t.client(co.workers[0]!.token);
      await expect(w.call(api.pro.earnings)).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
      await expect(w.call(api.pro.getPayoutMethod)).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        w.call(api.pro.setPayoutMethod, {
          body: { type: 'CARD', number: '4242424242424242', holderName: 'Rauf Hüseynov' },
        }),
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      const u = await createUser(t);
      const token = await tokenFor(t, u.userId, 'PRO');
      await expect(t.client(token).call(api.pro.earnings)).rejects.toMatchObject({
        code: 'NOT_FOUND',
        status: 404,
      });
    });

    it('company payout method: managers only', async () => {
      const co = await createCompany(t, { workers: 1 });
      const params = { companyId: co.companyId };
      const m = t.client(co.manager.token);
      expect(await m.call(api.company.getPayoutMethod, { params })).toEqual({ method: null });
      const set = await m.call(api.company.setPayoutMethod, {
        params,
        body: { type: 'IBAN', number: 'AZ77AIIB40060019440000216101', holderName: 'FixPro MMC' },
      });
      expect(set).toMatchObject({ type: 'IBAN', maskedNumber: 'AZ77 •••• 6101', holderName: 'FixPro MMC' });
      expect((await m.call(api.company.getPayoutMethod, { params })).method).toEqual(set);
      const w = t.client(co.workers[0]!.token);
      await expect(w.call(api.company.getPayoutMethod, { params })).rejects.toMatchObject({
        code: 'NOT_COMPANY_MANAGER',
        status: 403,
      });
      await expect(
        w.call(api.company.setPayoutMethod, {
          params,
          body: { type: 'CARD', number: '4242424242424242', holderName: 'Rauf Hüseynov' },
        }),
      ).rejects.toMatchObject({ code: 'NOT_COMPANY_MANAGER' });
      await expect(
        m.call(api.company.getPayoutMethod, { params: { companyId: crypto.randomUUID() } }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('earnings view', () => {
    it('solo handyman: balance, this Baku week split by card/cash, tips, pending payouts, payout method', async () => {
      t.clock.set(WEDNESDAY);
      expect(startOfBakuWeek(t.clock.now()).toISOString()).toBe(WEEK_START);
      const c = await createCustomer(t);
      const h = await createSoloHandyman(t);
      const other = await createSoloHandyman(t);
      const co = await createCompany(t, { workers: 1 });
      const base = { customer: c, handymanId: h.handymanId, acceptedByUserId: h.userId };
      await createCompletedAssignment(t, {
        ...base,
        paymentMethod: 'CARD',
        total: 4500,
        tip: 500,
        completedAt: new Date('2026-10-27T10:00:00Z'),
      });
      await createCompletedAssignment(t, {
        ...base,
        paymentMethod: 'CARD',
        total: 3000,
        completedAt: new Date('2026-10-28T06:00:00Z'),
      });
      await createCompletedAssignment(t, {
        ...base,
        paymentMethod: 'CASH',
        total: 2000,
        completedAt: new Date(WEEK_START),
      }); // Monday 00:00 Baku: included
      await createCompletedAssignment(t, {
        ...base,
        paymentMethod: 'CASH',
        total: 1500,
        tip: 300,
        completedAt: new Date('2026-10-25T19:59:59Z'),
      }); // Sunday: last week
      await createCompletedAssignment(t, {
        ...base,
        paymentMethod: 'CARD',
        total: 9999,
        completedAt: new Date('2026-10-28T09:00:00Z'),
      }); // after "now"
      await createCompletedAssignment(t, {
        customer: c,
        handymanId: other.handymanId,
        acceptedByUserId: other.userId,
        paymentMethod: 'CARD',
        total: 7000,
        completedAt: new Date('2026-10-27T10:00:00Z'),
      });
      await createCompletedAssignment(t, {
        customer: c,
        handymanId: co.workers[0]!.handymanId,
        acceptedByUserId: co.workers[0]!.userId,
        companyId: co.companyId,
        paymentMethod: 'CARD',
        total: 8000,
        completedAt: new Date('2026-10-27T10:00:00Z'),
      });
      await credit(h.earningsAccountId!, 7500);
      await credit(h.earningsAccountId!, 500, 'TIP');
      await t
        .client(h.token)
        .call(api.pro.setPayoutMethod, {
          body: { type: 'CARD', number: '4242424242424242', holderName: 'Elvin Məmmədov' },
        });

      const view = await t.client(h.token).call(api.pro.earnings);
      expect(view.earningsBalance).toBe(8000);
      expect(view.pendingPayouts).toBe(0);
      expect(view.payouts).toEqual([]);
      expect(view.thisWeek).toEqual({
        cardJobs: 2,
        cardTotal: 7500,
        tips: 500,
        cashJobs: 1,
        cashTotal: 2000,
      });
      expect(view.payoutMethod).toMatchObject({ type: 'CARD', maskedNumber: '•••• 4242' });

      // after the weekly run the money is pending
      const admin = await adminToken(t);
      await t.client(admin.token).call(api.admin.runPayouts);
      const after = await t.client(h.token).call(api.pro.earnings);
      expect(after.earningsBalance).toBe(0);
      expect(after.pendingPayouts).toBe(8000);
      expect(after.payouts).toHaveLength(1);
      expect(after.payouts[0]).toMatchObject({
        amount: 8000,
        status: 'PENDING',
        periodStart: PREV_WEEK_START,
        periodEnd: WEEK_START,
        paidAt: null,
        failureReason: null,
        method: { type: 'CARD', maskedNumber: '•••• 4242', holderName: 'Elvin Məmmədov' },
      });
    });

    it('company: only the company jobs and money; managers only', async () => {
      t.clock.set(WEDNESDAY);
      const c = await createCustomer(t);
      const co = await createCompany(t, { workers: 2 });
      const [w1, w2] = co.workers;
      await createCompletedAssignment(t, {
        customer: c,
        handymanId: w1!.handymanId,
        acceptedByUserId: co.manager.userId,
        companyId: co.companyId,
        paymentMethod: 'CARD',
        total: 10000,
        tip: 1000,
        completedAt: new Date('2026-10-26T10:00:00Z'),
      });
      await createCompletedAssignment(t, {
        customer: c,
        handymanId: w2!.handymanId,
        acceptedByUserId: co.manager.userId,
        companyId: co.companyId,
        paymentMethod: 'CASH',
        total: 6000,
        completedAt: new Date('2026-10-27T10:00:00Z'),
      });
      await credit(co.earningsAccountId, 11000);
      const view = await t
        .client(co.manager.token)
        .call(api.company.earnings, { params: { companyId: co.companyId } });
      expect(view).toMatchObject({
        earningsBalance: 11000,
        pendingPayouts: 0,
        payouts: [],
        thisWeek: { cardJobs: 1, cardTotal: 10000, tips: 1000, cashJobs: 1, cashTotal: 6000 },
        payoutMethod: null,
      });
      await expect(
        t.client(w1!.token).call(api.company.earnings, { params: { companyId: co.companyId } }),
      ).rejects.toMatchObject({
        code: 'NOT_COMPANY_MANAGER',
      });
    });
  });

  describe('weekly payouts', () => {
    it('creates one payout per positive earnings account per week (idempotent), paid flow moves money out', async () => {
      t.clock.set(WEDNESDAY);
      const h = await createSoloHandyman(t, { firstName: 'Elvin', lastName: 'Məmmədov' });
      const zero = await createSoloHandyman(t);
      const co = await createCompany(t, { name: 'Usta Servis MMC' });
      await credit(h.earningsAccountId!, 12_000);
      await credit(co.earningsAccountId, 30_000);
      void zero;
      const admin = await adminToken(t);
      const ac = t.client(admin.token);

      expect(await ac.call(api.admin.runPayouts)).toEqual({ created: 2, total: 42_000 });
      expect(await ac.call(api.admin.runPayouts)).toEqual({ created: 0, total: 0 });
      // new earnings in the same week wait for next week's run
      await credit(h.earningsAccountId!, 2_000);
      await t.jobs.runNow(PAYOUTS_WEEKLY_JOB, {});
      expect(await t.prisma.payout.count()).toBe(2);
      expect((await t.ledger.balance(h.earningsAccountId!)).posted).toBe(2_000);
      const transit = await t.ledger.platformAccountId('PAYOUTS_IN_TRANSIT');
      expect((await t.ledger.balance(transit)).posted).toBe(42_000);

      const hp = await t.prisma.payout.findFirstOrThrow({ where: { handymanId: h.handymanId } });
      expect(hp.idempotencyKey).toBe(`payout:HANDYMAN:${h.handymanId}:2026-W44`);
      const created = await t.prisma.ledgerTransaction.findFirstOrThrow({ where: { payoutId: hp.id } });
      expect(created.kind).toBe('PAYOUT_CREATED');

      const list = await ac.call(api.admin.payouts);
      expect(list.items).toHaveLength(2);
      const byOwner = Object.fromEntries(list.items.map((p) => [p.ownerType, p]));
      expect(byOwner.HANDYMAN).toMatchObject({
        ownerId: h.handymanId,
        ownerName: 'Elvin Məmmədov',
        amount: 12_000,
        status: 'PENDING',
        method: null,
      });
      expect(byOwner.COMPANY).toMatchObject({
        ownerId: co.companyId,
        ownerName: 'Usta Servis MMC',
        amount: 30_000,
        status: 'PENDING',
      });

      const paid = await ac.call(api.admin.markPayoutPaid, { params: { id: hp.id } });
      expect(paid).toMatchObject({ id: hp.id, status: 'PAID', ownerName: 'Elvin Məmmədov', amount: 12_000 });
      // paidAt is business time (Clock), i.e. in the simulated week
      expect(Math.abs(Date.parse(paid.paidAt!) - t.clock.nowMs())).toBeLessThan(5_000);
      expect((await t.ledger.balance(transit)).posted).toBe(30_000);
      const audit = await t.prisma.auditLog.findFirstOrThrow({
        where: { action: 'payout.paid', entityId: hp.id },
      });
      expect(audit).toMatchObject({ actorType: 'ADMIN', actorId: admin.adminId, entityType: 'Payout' });
      await expect(ac.call(api.admin.markPayoutPaid, { params: { id: hp.id } })).rejects.toMatchObject({
        code: 'INVALID_STATE',
        status: 409,
      });
      await expect(
        ac.call(api.admin.markPayoutFailed, { params: { id: hp.id }, body: { reason: 'Kart bloklanıb' } }),
      ).rejects.toMatchObject({
        code: 'INVALID_STATE',
      });
      await expect(
        ac.call(api.admin.markPayoutPaid, { params: { id: crypto.randomUUID() } }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      const pendingOnly = await ac.call(api.admin.payouts, { query: { status: 'PENDING' } });
      expect(pendingOnly.items.map((p) => p.ownerType)).toEqual(['COMPANY']);

      // next week: a new payout for the new money only
      t.clock.advance(7 * 86_400_000);
      const admin2 = await adminToken(t); // access tokens expire with business time
      expect(await t.client(admin2.token).call(api.admin.runPayouts)).toEqual({ created: 1, total: 2_000 });
      const next = await t.prisma.payout.findFirstOrThrow({
        where: { handymanId: h.handymanId, status: 'PENDING' },
      });
      expect(next.idempotencyKey).toBe(`payout:HANDYMAN:${h.handymanId}:2026-W45`);
      expect(next.periodStart.toISOString()).toBe(WEEK_START);
    });

    it('failed flow returns the money to earnings with the reason', async () => {
      t.clock.set(WEDNESDAY);
      const co = await createCompany(t);
      await t.client(co.manager.token).call(api.company.setPayoutMethod, {
        params: { companyId: co.companyId },
        body: { type: 'IBAN', number: 'AZ21NABZ00000000137010001944', holderName: 'FixPro MMC' },
      });
      await credit(co.earningsAccountId, 5_000);
      const admin = await adminToken(t);
      const ac = t.client(admin.token);
      await ac.call(api.admin.runPayouts);
      const p = await t.prisma.payout.findFirstOrThrow({ where: { companyId: co.companyId } });
      expect(p.methodSnapshot).toMatchObject({ type: 'IBAN', maskedNumber: 'AZ21 •••• 1944' });
      expect((await t.ledger.balance(co.earningsAccountId)).posted).toBe(0);

      await expect(
        ac.call(api.admin.markPayoutFailed, { params: { id: p.id }, body: { reason: 'x' } }),
      ).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
      const failed = await ac.call(api.admin.markPayoutFailed, {
        params: { id: p.id },
        body: { reason: 'IBAN bankda tapılmadı' },
      });
      expect(failed).toMatchObject({
        status: 'FAILED',
        failureReason: 'IBAN bankda tapılmadı',
        paidAt: null,
        ownerType: 'COMPANY',
      });
      expect(failed.method).toMatchObject({ maskedNumber: 'AZ21 •••• 1944' });
      expect((await t.ledger.balance(co.earningsAccountId)).posted).toBe(5_000);
      const transit = await t.ledger.platformAccountId('PAYOUTS_IN_TRANSIT');
      expect((await t.ledger.balance(transit)).posted).toBe(0);
      expect(await t.prisma.auditLog.count({ where: { action: 'payout.failed', entityId: p.id } })).toBe(1);
      await expect(ac.call(api.admin.markPayoutPaid, { params: { id: p.id } })).rejects.toMatchObject({
        code: 'INVALID_STATE',
      });

      const view = await t
        .client(co.manager.token)
        .call(api.company.earnings, { params: { companyId: co.companyId } });
      expect(view.earningsBalance).toBe(5_000);
      expect(view.pendingPayouts).toBe(0);
      expect(view.payouts[0]).toMatchObject({ status: 'FAILED', failureReason: 'IBAN bankda tapılmadı' });
    });

    it('concurrent runs never create duplicate payouts', async () => {
      t.clock.set(WEDNESDAY);
      const hs = await Promise.all([1, 2, 3].map(() => createSoloHandyman(t)));
      for (const h of hs) await credit(h.earningsAccountId!, 1_000);
      const results = await Promise.all([1, 2, 3].map(() => t.jobs.runNow(PAYOUTS_WEEKLY_JOB, {})));
      expect(results).toHaveLength(3);
      expect(await t.prisma.payout.count()).toBe(3);
      const transit = await t.ledger.platformAccountId('PAYOUTS_IN_TRANSIT');
      expect((await t.ledger.balance(transit)).posted).toBe(3_000);
    });

    it('admin payout endpoints require an admin token; list pages with a cursor', async () => {
      t.clock.set(WEDNESDAY);
      const h = await createSoloHandyman(t);
      await expect(t.client(h.token).call(api.admin.runPayouts)).rejects.toMatchObject({
        code: 'FORBIDDEN',
        status: 403,
      });
      await expect(t.client(h.token).call(api.admin.payouts)).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(t.client(null).call(api.admin.payouts)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
      const hs = await Promise.all([1, 2, 3].map(() => createSoloHandyman(t)));
      for (const x of hs) await credit(x.earningsAccountId!, 1_000);
      const admin = await adminToken(t);
      const ac = t.client(admin.token);
      await ac.call(api.admin.runPayouts);
      expect(await t.prisma.auditLog.count({ where: { action: 'payouts.run' } })).toBe(1);
      const p1 = await ac.call(api.admin.payouts, { query: { limit: 2 } });
      expect(p1.items).toHaveLength(2);
      const p2 = await ac.call(api.admin.payouts, { query: { limit: 2, cursor: p1.nextCursor! } });
      expect(p2.items).toHaveLength(1);
      expect(p2.nextCursor).toBeNull();
      expect(new Set([...p1.items, ...p2.items].map((p) => p.id)).size).toBe(3);
    });

    it('Baku week boundary: Sunday 23:59:59 runs in the old week, Monday 00:00 Baku (still Sunday in UTC) in the new one', async () => {
      const payouts = t.app.get(PayoutsService);
      const SUNDAY_LAST_SECOND = '2026-11-01T19:59:59.000Z'; // Sunday 2026-11-01 23:59:59 Baku
      const MONDAY_MIDNIGHT = '2026-11-01T20:00:00.000Z'; // Monday 2026-11-02 00:00:00 Baku (UTC: Sunday 20:00)
      const h = await createSoloHandyman(t);
      const c = await createCustomer(t);
      await credit(h.earningsAccountId!, 1_000);

      t.clock.set(SUNDAY_LAST_SECOND);
      expect(startOfBakuWeek(t.clock.now()).toISOString()).toBe(WEEK_START);
      await createCompletedAssignment(t, {
        customer: c,
        handymanId: h.handymanId,
        acceptedByUserId: h.userId,
        paymentMethod: 'CARD',
        total: 4_000,
        completedAt: t.clock.now(),
      });
      const before = await t.client(await tokenFor(t, h.userId, 'PRO')).call(api.pro.earnings);
      expect(before.thisWeek).toMatchObject({ cardJobs: 1, cardTotal: 4_000 });
      expect(await payouts.runPayouts()).toEqual({ created: 1, total: 1_000 });
      const old = await t.prisma.payout.findFirstOrThrow({ where: { handymanId: h.handymanId } });
      expect(old.idempotencyKey).toBe(`payout:HANDYMAN:${h.handymanId}:2026-W44`);
      expect(old.periodStart.toISOString()).toBe(PREV_WEEK_START);
      expect(old.periodEnd.toISOString()).toBe(WEEK_START);
      // business time (Clock), not the database clock
      expect(Math.abs(old.createdAt.getTime() - Date.parse(SUNDAY_LAST_SECOND))).toBeLessThan(5_000);
      // a second run in the same last second of the week is a no-op
      await credit(h.earningsAccountId!, 500);
      expect(await payouts.runPayouts()).toEqual({ created: 0, total: 0 });

      t.clock.set(MONDAY_MIDNIGHT);
      expect(startOfBakuWeek(t.clock.now()).toISOString()).toBe(MONDAY_MIDNIGHT);
      const after = await t.client(await tokenFor(t, h.userId, 'PRO')).call(api.pro.earnings);
      expect(after.thisWeek).toMatchObject({ cardJobs: 0, cardTotal: 0 });
      expect(await payouts.runPayouts()).toEqual({ created: 1, total: 500 });
      const next = await t.prisma.payout.findFirstOrThrow({
        where: { handymanId: h.handymanId, id: { not: old.id } },
      });
      expect(next.idempotencyKey).toBe(`payout:HANDYMAN:${h.handymanId}:2026-W45`);
      expect(next.periodStart.toISOString()).toBe(WEEK_START);
      expect(next.periodEnd.toISOString()).toBe(MONDAY_MIDNIGHT);
      expect(Math.abs(next.createdAt.getTime() - Date.parse(MONDAY_MIDNIGHT))).toBeLessThan(5_000);
      // the earnings list is ordered by business time: newest payout first
      expect(after.payouts.map((p) => p.id)).toEqual([old.id]);
      const latest = await t.client(await tokenFor(t, h.userId, 'PRO')).call(api.pro.earnings);
      expect(latest.payouts.map((p) => p.id)).toEqual([next.id, old.id]);
      expect(latest.pendingPayouts).toBe(1_500);
      expect(latest.earningsBalance).toBe(0);
    });

    it('concurrent mark-paid and mark-failed on the same payout: exactly one wins, money moves once', async () => {
      t.clock.set(WEDNESDAY);
      const h = await createSoloHandyman(t);
      await credit(h.earningsAccountId!, 7_000);
      const admin = await adminToken(t);
      const ac = t.client(admin.token);
      await ac.call(api.admin.runPayouts);
      const p = await t.prisma.payout.findFirstOrThrow({ where: { handymanId: h.handymanId } });
      const results = await Promise.allSettled([
        ac.call(api.admin.markPayoutPaid, { params: { id: p.id } }),
        ac.call(api.admin.markPayoutFailed, { params: { id: p.id }, body: { reason: 'Bank rədd etdi' } }),
        ac.call(api.admin.markPayoutPaid, { params: { id: p.id } }),
        ac.call(api.admin.markPayoutFailed, { params: { id: p.id }, body: { reason: 'Bank rədd etdi' } }),
        ac.call(api.admin.markPayoutPaid, { params: { id: p.id } }),
        ac.call(api.admin.markPayoutFailed, { params: { id: p.id }, body: { reason: 'Bank rədd etdi' } }),
      ]);
      const ok = results.filter((r) => r.status === 'fulfilled');
      const refused = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(ok).toHaveLength(1);
      expect(refused).toHaveLength(5);
      for (const r of refused) expect(r.reason).toMatchObject({ code: 'INVALID_STATE', status: 409 });

      const final = await t.prisma.payout.findUniqueOrThrow({ where: { id: p.id } });
      expect(['PAID', 'FAILED']).toContain(final.status);
      expect(await t.prisma.ledgerTransaction.count({ where: { payoutId: p.id } })).toBe(2);
      expect(
        await t.prisma.auditLog.count({
          where: { entityId: p.id, action: { in: ['payout.paid', 'payout.failed'] } },
        }),
      ).toBe(1);
      const transit = await t.ledger.platformAccountId('PAYOUTS_IN_TRANSIT');
      expect((await t.ledger.balance(transit)).posted).toBe(0);
      expect((await t.ledger.balance(h.earningsAccountId!)).posted).toBe(final.status === 'FAILED' ? 7_000 : 0);
    });

    it('a weekly run concurrent with admins failing older payouts never deadlocks or skips an owner', async () => {
      const payouts = t.app.get(PayoutsService);
      t.clock.set(WEDNESDAY);
      const admin = await adminToken(t);
      const hs = await Promise.all([1, 2, 3, 4, 5, 6].map(() => createSoloHandyman(t)));
      for (const h of hs) await credit(h.earningsAccountId!, 1_000);
      expect(await payouts.runPayouts()).toEqual({ created: 6, total: 6_000 });
      const older = await t.prisma.payout.findMany({ where: { status: 'PENDING' } });
      t.clock.advance(7 * 86_400_000);
      for (const h of hs) await credit(h.earningsAccountId!, 500);

      const [run, ...failedCalls] = await Promise.all([
        payouts.runPayouts(),
        ...older.map((p) => payouts.markFailed(p.id, admin.adminId, 'Kart bloklanıb', null)),
      ]);
      expect(run.created).toBe(6);
      expect(failedCalls.every((f) => f.status === 'FAILED')).toBe(true);
      for (const h of hs) {
        const fresh = await t.prisma.payout.findFirstOrThrow({
          where: { handymanId: h.handymanId, idempotencyKey: { endsWith: ':2026-W45' } },
        });
        // whichever ran first, nothing is lost: returned money is either in this payout or back on earnings
        const earnings = (await t.ledger.balance(h.earningsAccountId!)).posted;
        expect(earnings + Number(fresh.amount)).toBe(1_500);
      }
    });

    it('a customer wallet balance is never paid out (only HANDYMAN/COMPANY earnings)', async () => {
      t.clock.set(WEDNESDAY);
      const c = await createCustomer(t, { balance: 50_000 });
      const h = await createSoloHandyman(t, { balance: 20_000 });
      await fund(t, c.walletAccountId, 1);
      void h;
      const admin = await adminToken(t);
      expect(await t.client(admin.token).call(api.admin.runPayouts)).toEqual({ created: 0, total: 0 });
    });
  });
});
