import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../helpers/app';
import { createCompany, createSoloHandyman } from '../helpers/factories';
import { PAYOUTS_CATCH_UP_TASK, PAYOUTS_WEEKLY_JOB, PayoutsService } from '../../src/modules/payouts/payouts.service';
import { expectLedgerClean } from './helpers';

/** Monday 2026-10-26 08:00 Baku (UTC+4): before the 09:00 weekly run. */
const MONDAY_0800 = '2026-10-26T04:00:00.000Z';
/** Monday 2026-10-26 09:30 Baku: the weekly run is due. */
const MONDAY_0930 = '2026-10-26T05:30:00.000Z';
/** Wednesday of the same ISO week (2026-W44). */
const WEDNESDAY = '2026-10-28T08:00:00.000Z';
/** Wednesday of the next ISO week (2026-W45). */
const NEXT_WEDNESDAY = '2026-11-04T08:00:00.000Z';

/**
 * Hardening of weekly payouts: demo bots never get payouts (their "earnings" are simulated), and when the Monday 09:00 cron
 * did not run (API down, Redis flushed, worker restarted at the wrong moment) the reconciler runs the week's payouts once.
 */
describe('A2 payouts: bots excluded, reconciler catch-up', () => {
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

  async function credit(accountId: string, amount: number) {
    const external = await t.ledger.platformAccountId('EXTERNAL');
    await t.ledger.post({
      kind: 'JOB_PAYMENT',
      idempotencyKey: `test-credit:${accountId}:${Math.random()}`,
      entries: [
        { accountId: external, amount: -amount },
        { accountId, amount },
      ],
    });
  }

  it('runPayouts skips demo bots; real handymen and companies are paid', async () => {
    t.clock.set(WEDNESDAY);
    const bot = await createSoloHandyman(t);
    await t.prisma.handymanProfile.update({ where: { id: bot.handymanId }, data: { isBot: true } });
    const h = await createSoloHandyman(t);
    const co = await createCompany(t);
    await credit(bot.earningsAccountId!, 5_000);
    await credit(h.earningsAccountId!, 3_000);
    await credit(co.earningsAccountId, 4_000);
    expect(await t.app.get(PayoutsService).runPayouts()).toEqual({ created: 2, total: 7_000 });
    expect(await t.prisma.payout.count({ where: { handymanId: bot.handymanId } })).toBe(0);
    expect((await t.ledger.balance(bot.earningsAccountId!)).posted).toBe(5_000);
    expect((await t.ledger.balance(h.earningsAccountId!)).posted).toBe(0);
  });

  it('the catch-up is a reconciler task (active with BullMQ; in manual mode tests drive it, there is no cron to miss)', () => {
    const tasks = (t.reconciler as unknown as { tasks: Map<string, unknown> }).tasks;
    expect(tasks.has(PAYOUTS_CATCH_UP_TASK)).toBe(true);
  });

  it('catch-up: nothing before Monday 09:00, one run once it is due, never a second run in the same week', async () => {
    const payouts = t.app.get(PayoutsService);
    const h = await createSoloHandyman(t);
    t.clock.set(MONDAY_0800);
    await credit(h.earningsAccountId!, 1_000);
    expect(await payouts.catchUpWeekly()).toEqual({ ran: false, created: 0, total: 0 });
    expect(await t.prisma.payout.count()).toBe(0);

    t.clock.set(MONDAY_0930); // the cron did not fire
    expect(await payouts.catchUpWeekly()).toEqual({ ran: true, created: 1, total: 1_000 });
    expect(await t.prisma.payout.findMany()).toMatchObject([{ handymanId: h.handymanId, amount: 1_000n, status: 'PENDING' }]);

    // Earnings later in the week wait for next week's run, also through the catch-up.
    t.clock.set(WEDNESDAY);
    await credit(h.earningsAccountId!, 700);
    expect(await payouts.catchUpWeekly()).toMatchObject({ ran: false });
    expect(await payouts.catchUpWeekly()).toMatchObject({ ran: false });
    expect(await t.prisma.payout.count()).toBe(1);

    t.clock.set(NEXT_WEDNESDAY);
    expect(await payouts.catchUpWeekly()).toEqual({ ran: true, created: 1, total: 700 });
    expect(await t.prisma.payout.count()).toBe(2);
    expect((await t.ledger.balance(h.earningsAccountId!)).posted).toBe(0);
  });

  it('a week whose cron already ran (even with nothing to pay) is not run again by the catch-up; the run is recorded', async () => {
    const payouts = t.app.get(PayoutsService);
    const h = await createSoloHandyman(t);
    t.clock.set(MONDAY_0930);
    await t.jobs.runNow(PAYOUTS_WEEKLY_JOB, {}); // nothing to pay yet
    expect(await t.prisma.auditLog.count({ where: { action: 'payouts.weekly', entityType: 'PayoutRun', entityId: '2026-W44' } })).toBe(1);
    t.clock.set(WEDNESDAY);
    await credit(h.earningsAccountId!, 2_000);
    expect(await payouts.catchUpWeekly()).toMatchObject({ ran: false });
    expect(await t.prisma.payout.count()).toBe(0);
    expect((await t.ledger.balance(h.earningsAccountId!)).posted).toBe(2_000);
  });

  it('an admin "run payouts" counts as the week\'s run too', async () => {
    const payouts = t.app.get(PayoutsService);
    const h = await createSoloHandyman(t);
    t.clock.set(WEDNESDAY);
    await credit(h.earningsAccountId!, 1_500);
    expect(await payouts.runPayouts()).toEqual({ created: 1, total: 1_500 });
    await credit(h.earningsAccountId!, 500);
    expect(await payouts.catchUpWeekly()).toMatchObject({ ran: false });
    expect(await t.prisma.payout.count()).toBe(1);
  });
});
