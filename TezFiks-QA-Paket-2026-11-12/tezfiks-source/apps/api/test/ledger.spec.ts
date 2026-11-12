import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { createCustomer, createSoloHandyman, fund } from './helpers/factories';
import { ApiException } from '../src/common/http/api-exception';

describe('ledger core', () => {
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

  it('posts balanced transactions, updates cached balances and is idempotent', async () => {
    const h = await createSoloHandyman(t);
    const external = await t.ledger.platformAccountId('EXTERNAL');
    const input = {
      kind: 'TOPUP' as const,
      idempotencyKey: 'topup-1',
      entries: [
        { accountId: external, amount: -5000 },
        { accountId: h.walletAccountId!, amount: 5000 },
      ],
    };
    const first = await t.ledger.post(input);
    const second = await t.ledger.post(input);
    expect(second).toEqual({ transactionId: first.transactionId, replayed: true });
    expect(await t.ledger.balance(h.walletAccountId!)).toEqual({ posted: 5000, held: 0, available: 5000 });
    expect(await t.ledger.globalSum()).toBe(0);
    expect(await t.ledger.verifyIntegrity()).toEqual([]);
  });

  it('stamps transactions, entries and holds with the business Clock, not the database clock', async () => {
    const h = await createSoloHandyman(t);
    const external = await t.ledger.platformAccountId('EXTERNAL');
    const revenue = await t.ledger.platformAccountId('REVENUE');
    // The Clock runs 3 days ahead of the database clock, so a DB-default timestamp falls far outside each window.
    t.clock.advance(3 * 86_400_000);
    const within = (ms: number | undefined, from: number, to: number) => expect(ms! >= from && ms! <= to, `${ms} in [${from}, ${to}]`).toBe(true);

    const postFrom = t.clock.nowMs();
    const { transactionId } = await t.ledger.post({
      kind: 'TOPUP',
      idempotencyKey: 'clock-topup',
      entries: [
        { accountId: external, amount: -3000 },
        { accountId: h.walletAccountId!, amount: 3000 },
      ],
    });
    const postTo = t.clock.nowMs();
    const txRow = await t.prisma.ledgerTransaction.findUniqueOrThrow({ where: { id: transactionId }, include: { entries: true } });
    within(txRow.createdAt.getTime(), postFrom, postTo);
    expect(txRow.entries).toHaveLength(2);
    for (const e of txRow.entries) expect(e.createdAt.getTime()).toBe(txRow.createdAt.getTime());

    t.clock.advance(60_000);
    const holdFrom = t.clock.nowMs();
    const released = await t.ledger.hold({ accountId: h.walletAccountId!, amount: 1000, kind: 'REQUEST_FEE' });
    const captured = await t.ledger.hold({ accountId: h.walletAccountId!, amount: 1000, kind: 'REQUEST_FEE' });
    const holdTo = t.clock.nowMs();
    within(released.createdAt.getTime(), holdFrom, holdTo);
    within(captured.createdAt.getTime(), holdFrom, holdTo);

    t.clock.advance(120_000);
    const resolveFrom = t.clock.nowMs();
    await t.ledger.releaseHold(released.id);
    await t.ledger.captureHold(captured.id, { kind: 'REQUEST_FEE_CAPTURE', toAccountId: revenue, idempotencyKey: 'clock-capture' });
    const resolveTo = t.clock.nowMs();
    const holds = await t.prisma.hold.findMany({ where: { id: { in: [released.id, captured.id] } } });
    expect(holds).toHaveLength(2);
    for (const x of holds) within(x.resolvedAt?.getTime(), resolveFrom, resolveTo);
    expect(await t.ledger.globalSum()).toBe(0);
    expect(await t.ledger.verifyIntegrity()).toEqual([]);
  });

  it('rejects unbalanced input before touching the database', async () => {
    const h = await createSoloHandyman(t);
    const external = await t.ledger.platformAccountId('EXTERNAL');
    await expect(
      t.ledger.post({ kind: 'TOPUP', idempotencyKey: 'bad', entries: [{ accountId: external, amount: -10 }, { accountId: h.walletAccountId!, amount: 9 }] }),
    ).rejects.toThrow(/Unbalanced/);
  });

  it('refuses to overdraw a wallet unless overdraft is allowed for that posting', async () => {
    const c = await createCustomer(t, { balance: 1000 });
    const revenue = await t.ledger.platformAccountId('REVENUE');
    const penalty = (key: string, allow: boolean) =>
      t.ledger.post({
        kind: 'CANCEL_PENALTY',
        idempotencyKey: key,
        entries: [
          { accountId: c.walletAccountId, amount: -1500 },
          { accountId: revenue, amount: 1500 },
        ],
        allowOverdraft: allow ? [c.walletAccountId] : [],
      });
    await expect(penalty('p1', false)).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
    await penalty('p2', true);
    const summary = await t.ledger.summary(c.walletAccountId);
    expect(summary).toMatchObject({ posted: -500, available: -500, isDebt: true });
  });

  it('holds, releases and captures fees exactly once', async () => {
    const h = await createSoloHandyman(t, { balance: 1500 });
    const revenue = await t.ledger.platformAccountId('REVENUE');
    const hold = await t.ledger.hold({ accountId: h.walletAccountId!, amount: 1000, kind: 'REQUEST_FEE' });
    expect(await t.ledger.balance(h.walletAccountId!)).toEqual({ posted: 1500, held: 1000, available: 500 });
    await expect(t.ledger.hold({ accountId: h.walletAccountId!, amount: 1000, kind: 'REQUEST_FEE' })).rejects.toBeInstanceOf(ApiException);

    const cap1 = await t.ledger.captureHold(hold.id, { kind: 'REQUEST_FEE_CAPTURE', toAccountId: revenue, idempotencyKey: 'cap-1' });
    const cap2 = await t.ledger.captureHold(hold.id, { kind: 'REQUEST_FEE_CAPTURE', toAccountId: revenue, idempotencyKey: 'cap-1' });
    expect(cap2.transactionId).toBe(cap1.transactionId);
    expect(await t.ledger.balance(h.walletAccountId!)).toEqual({ posted: 500, held: 0, available: 500 });
    expect((await t.ledger.balance(revenue)).posted).toBe(1000);

    const hold2 = await t.ledger.hold({ accountId: h.walletAccountId!, amount: 500, kind: 'REQUEST_FEE' });
    await t.ledger.releaseHold(hold2.id);
    await t.ledger.releaseHold(hold2.id);
    expect(await t.ledger.balance(h.walletAccountId!)).toEqual({ posted: 500, held: 0, available: 500 });
    await expect(t.ledger.captureHold(hold2.id, { kind: 'REQUEST_FEE_CAPTURE', toAccountId: revenue, idempotencyKey: 'cap-2' })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(await t.ledger.verifyIntegrity()).toEqual([]);
    expect(await t.ledger.globalSum()).toBe(0);
  });

  it('serializes concurrent holds so a balance is never spent twice', async () => {
    const h = await createSoloHandyman(t, { balance: 1000 });
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => t.ledger.hold({ accountId: h.walletAccountId!, amount: 1000, kind: 'REQUEST_FEE' })),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await t.ledger.balance(h.walletAccountId!)).toEqual({ posted: 1000, held: 1000, available: 0 });
  });

  it('lists account transactions newest first with request numbers and a cursor', async () => {
    const h = await createSoloHandyman(t);
    for (let i = 0; i < 3; i++) await fund(t, h.walletAccountId!, 100 * (i + 1));
    const page1 = await t.ledger.listTransactions(h.walletAccountId!, { limit: 2 });
    expect(page1.items.map((i) => i.amount)).toEqual([300, 200]);
    expect(page1.items[0]).toMatchObject({ kind: 'TOPUP', balanceAfter: 600 });
    const page2 = await t.ledger.listTransactions(h.walletAccountId!, { limit: 2, cursor: page1.nextCursor! });
    expect(page2.items.map((i) => i.amount)).toEqual([100]);
    expect(page2.nextCursor).toBeNull();
  });

  it('enforces the zero-sum rule in the database itself', async () => {
    const h = await createSoloHandyman(t);
    await expect(
      t.prisma.$transaction(async (tx) => {
        const txRow = await tx.ledgerTransaction.create({ data: { kind: 'TOPUP', idempotencyKey: 'raw-unbalanced' } });
        await tx.ledgerEntry.create({ data: { transactionId: txRow.id, accountId: h.walletAccountId!, amount: 100n, balanceAfter: 100n } });
      }),
    ).rejects.toThrow(/unbalanced/);
  });
});
