import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normalizeAzMobile } from '@tezfiks/shared';
import type { TestApp } from '../helpers/app';
import { BAKU } from '../helpers/factories';
import { DemoSeedService, type DemoSeedResult } from '../../src/modules/demo/demo-seed.service';
import { SEED_PEOPLE } from '../../src/modules/demo/demo-seed.data';
import { DEMO_CUSTOMER } from '../../src/modules/demo/demo.constants';
import { createDemoApp, expectLedgerBalanced } from './helpers';

/** The demo seed through the real services (plan lane B6): every status, balances, idempotency, ledger invariants. */
describe('demo seed', () => {
  let t: TestApp;
  let result: DemoSeedResult;
  const lines: string[] = [];

  beforeAll(async () => {
    t = await createDemoApp();
    await t.reset();
    result = await t.app.get(DemoSeedService).run({ log: (l) => lines.push(l) });
  }, 600_000);
  afterAll(async () => {
    await t.close();
  });

  const userByPhone = (phone: string) => t.prisma.user.findUniqueOrThrow({ where: { phone }, include: { handymanProfile: true, customerAccount: true } });

  it('runs every step, restores the Clock and lists the logins', async () => {
    expect(result.skipped).toBe(false);
    expect(result.marker.completedAt).toBeTruthy();
    expect(Object.keys(result.marker.steps).sort()).toEqual(['accounts', 'balances', 'guaranteeCase', 'history', 'inProgress', 'project']);
    expect(Math.abs(t.clock.nowMs() - Date.now())).toBeLessThan(5000);
    expect(result.logins).toHaveLength(10);
    for (const l of result.logins) expect(normalizeAzMobile(l.phone)).toBe(l.phone);
    expect(result.logins.map((l) => l.phone).sort()).toEqual(Object.values(SEED_PEOPLE).map((p) => p.phone).sort());
    expect(lines.length).toBeGreaterThan(0);
  });

  it('keeps the ledger balanced', async () => {
    await expectLedgerBalanced(t);
  });

  it('seeds the providers: Elvin approved with 34 AZN near the centre, Samir pending, Vüqar blocked', async () => {
    const elvin = await userByPhone(SEED_PEOPLE.elvin.phone);
    expect(elvin).toMatchObject({ firstName: 'Elvin', lastName: 'Məmmədov', status: 'ACTIVE' });
    const p = elvin.handymanProfile!;
    expect(p).toMatchObject({ kind: 'SOLO', status: 'APPROVED', isBot: false, isOnline: false });
    expect(Math.hypot(p.baseLat! - BAKU.center.lat, p.baseLng! - BAKU.center.lng)).toBeLessThan(0.02);
    const trades = await t.prisma.handymanTrade.findMany({ where: { handymanId: p.id }, include: { category: true } });
    expect(trades.map((x) => x.category.slug)).toContain('plumbing');
    expect((await t.ledger.balance(p.walletAccountId!)).available).toBe(3400);
    const sub = await t.prisma.verificationSubmission.findFirstOrThrow({ where: { handymanId: p.id } });
    expect(sub.status).toBe('APPROVED');

    const samir = await userByPhone(SEED_PEOPLE.samir.phone);
    expect(samir.handymanProfile!.status).toBe('PENDING_REVIEW');
    const pending = await t.prisma.verificationSubmission.findFirstOrThrow({ where: { handymanId: samir.handymanProfile!.id } });
    expect(pending.status).toBe('PENDING_REVIEW');
    const files = await t.prisma.file.findMany({
      where: { id: { in: [pending.idFrontFileId, pending.idBackFileId, pending.selfieFrontFileId, pending.selfieTurnFileId, pending.selfieBlinkFileId] } },
    });
    expect(files).toHaveLength(5);

    const vuqar = await userByPhone(SEED_PEOPLE.vuqar.phone);
    expect(vuqar.handymanProfile!.status).toBe('BLOCKED');
  });

  it('seeds FixPro MMC: approved, 240 AZN, manager Rauf and workers Tural and Kamran', async () => {
    const company = await t.prisma.company.findFirstOrThrow({ where: { name: 'FixPro MMC' }, include: { members: { include: { user: true } } } });
    expect(company.status).toBe('APPROVED');
    expect((await t.ledger.balance(company.walletAccountId)).available).toBe(24_000);
    const roles = Object.fromEntries(company.members.map((m) => [m.user.firstName, `${m.role}:${m.status}`]));
    expect(roles).toEqual({ Rauf: 'MANAGER:ACTIVE', Tural: 'WORKER:ACTIVE', Kamran: 'WORKER:ACTIVE' });
    for (const phone of [SEED_PEOPLE.tural.phone, SEED_PEOPLE.kamran.phone]) {
      const w = await userByPhone(phone);
      expect(w.handymanProfile).toMatchObject({ kind: 'COMPANY_WORKER', companyId: company.id, status: 'APPROVED' });
    }
  });

  it('seeds the customers: Nizami, Aysel, Kontur MMC (VÖEN 1234567890) and the demo customer', async () => {
    const nizami = await userByPhone(SEED_PEOPLE.nizami.phone);
    const aysel = await userByPhone(SEED_PEOPLE.aysel.phone);
    const kontur = await userByPhone(SEED_PEOPLE.kontur.phone);
    const demo = await userByPhone(DEMO_CUSTOMER.phone);
    expect(nizami.customerAccount!.type).toBe('INDIVIDUAL');
    expect(aysel).toMatchObject({ firstName: 'Aysel', lastName: 'Qasımova' });
    expect(kontur.customerAccount).toMatchObject({ type: 'COMPANY', companyName: 'Kontur MMC', voen: '1234567890' });
    expect(demo.customerAccount).not.toBeNull();
    for (const u of [nizami, aysel, kontur, demo]) {
      expect((await t.ledger.balance(u.customerAccount!.walletAccountId)).posted).toBeGreaterThanOrEqual(0);
    }
  });

  it('plays requests in every status through the real flows', async () => {
    const reqs = await t.prisma.serviceRequest.findMany({ include: { assignments: true, customerAccount: { include: { owner: true } } } });
    const byStatus = (s: string) => reqs.filter((r) => r.status === s);
    expect(byStatus('COMPLETED')).toHaveLength(2);
    expect(byStatus('CANCELLED')).toHaveLength(2);
    expect(byStatus('EXPIRED')).toHaveLength(1);
    expect(byStatus('IN_PROGRESS')).toHaveLength(1);
    const twoDaysAgo = Date.now() - 2 * 86_400_000;
    for (const r of reqs.filter((x) => x.status !== 'IN_PROGRESS')) {
      expect(r.createdAt.getTime()).toBeGreaterThanOrEqual(twoDaysAgo - 60_000);
      expect(r.createdAt.getTime()).toBeLessThan(Date.now() - 86_400_000);
    }

    const all = reqs.flatMap((r) => r.assignments);
    const cash = all.find((a) => a.status === 'COMPLETED' && a.paymentMethod === 'CASH')!;
    expect(cash).toBeTruthy();
    expect(cash.guaranteeUntil).toBeNull();
    expect(cash.customerRatedAt).not.toBeNull();
    expect(cash.providerRatedAt).not.toBeNull();
    expect(Number(cash.totalAmount)).toBe(5500);

    const card = all.find((a) => a.status === 'COMPLETED' && a.paymentMethod === 'CARD')!;
    expect(card).toBeTruthy();
    expect(card.providerType).toBe('COMPANY');
    expect(card.guaranteeUntil).not.toBeNull();
    expect(Number(card.tipAmount)).toBe(500);
    const intents = await t.prisma.paymentIntent.findMany({ where: { assignmentId: card.id } });
    expect(intents.map((i) => `${i.purpose}:${i.status}`).sort()).toEqual(['JOB_PAYMENT:SUCCEEDED', 'TIP:SUCCEEDED']);

    expect(all.filter((a) => a.status === 'CANCELLED_FREE')).toHaveLength(1);
    const late = all.find((a) => a.status === 'CANCELLED_BY_CUSTOMER')!;
    expect(late).toBeTruthy();
    expect(await t.prisma.ledgerTransaction.count({ where: { kind: 'CANCEL_PENALTY' } })).toBe(1);
    expect(await t.prisma.ledgerTransaction.count({ where: { kind: 'PENALTY_COMPENSATION' } })).toBe(1);

    const expired = byStatus('EXPIRED')[0]!;
    expect(expired.customerAccount.companyName).toBe('Kontur MMC');
    expect(expired.assignments).toHaveLength(0);

    const live = byStatus('IN_PROGRESS')[0]!;
    expect(live.customerAccount.owner.phone).toBe(SEED_PEOPLE.nizami.phone);
    expect(live.assignments).toHaveLength(1);
    expect(live.assignments[0]!.status).toBe('EN_ROUTE');
    const kamran = await userByPhone(SEED_PEOPLE.kamran.phone);
    expect(live.assignments[0]!.handymanId).toBe(kamran.handymanProfile!.id);
    expect(live.createdAt.getTime()).toBeGreaterThan(Date.now() - 3_600_000);
  });

  it('seeds a B2B project with two quotes and an open guarantee case', async () => {
    const project = await t.prisma.project.findFirstOrThrow({ include: { quotes: true } });
    expect(project.status).toBe('OPEN');
    expect(project.quotes).toHaveLength(2);
    expect(project.quotes.every((q) => q.status === 'SUBMITTED')).toBe(true);
    expect(project.quotes.some((q) => q.companyId)).toBe(true);
    expect(project.quotes.some((q) => q.handymanId)).toBe(true);

    const c = await t.prisma.case.findFirstOrThrow({ where: { type: 'GUARANTEE' } });
    expect(c.status).toBe('OPEN');
    expect(c.photoFileIds).toHaveLength(1);
    expect(c.assignmentId).toBe(result.marker.data.cardAssignmentId);
  });

  it('is idempotent: a second run changes nothing', async () => {
    const counts = async () => ({
      users: await t.prisma.user.count(),
      requests: await t.prisma.serviceRequest.count(),
      assignments: await t.prisma.assignment.count(),
      ledger: await t.prisma.ledgerTransaction.count(),
      projects: await t.prisma.project.count(),
      cases: await t.prisma.case.count(),
      files: await t.prisma.file.count(),
    });
    const before = await counts();
    const again = await t.app.get(DemoSeedService).run({ log: () => undefined });
    expect(again.skipped).toBe(true);
    expect(await counts()).toEqual(before);
    await expectLedgerBalanced(t);

    // An interrupted seed resumes at the unfinished steps; re-running them does not duplicate cases or postings.
    const marker = { ...again.marker, steps: { ...again.marker.steps } };
    delete marker.completedAt;
    delete marker.steps.guaranteeCase;
    delete marker.steps.balances;
    await t.prisma.platformSetting.update({ where: { key: 'demo.seed' }, data: { value: marker as never } });
    const resumed = await t.app.get(DemoSeedService).run({ log: () => undefined });
    expect(resumed.skipped).toBe(false);
    expect(resumed.marker.completedAt).toBeTruthy();
    expect(await counts()).toEqual(before);
    await expectLedgerBalanced(t);
  });
});
