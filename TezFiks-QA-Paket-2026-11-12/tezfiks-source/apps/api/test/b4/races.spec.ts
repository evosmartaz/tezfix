import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api } from '@tezfiks/shared';
import { createTestApp, type TestApp } from '../helpers/app';
import { adminToken, createCustomer } from '../helpers/factories';
import { balanceOf, company, createProject, expectLedgerSound, quote, revenue, solo } from './helpers';

const ROUNDS = 5;

/** Every concurrent loser must fail with a domain error (never a 500 from a deadlock / write conflict). */
function expectDomainRejections(results: PromiseSettledResult<unknown>[], allowed: string[]): void {
  for (const r of results) {
    if (r.status === 'rejected') {
      const reason = r.reason as { code?: string; status?: number; message?: string };
      expect(reason.status, `unexpected failure: ${reason.code} ${reason.message}`).not.toBe(500);
      expect(allowed).toContain(reason.code);
    }
  }
}

function fulfilled(results: PromiseSettledResult<unknown>[]): number {
  return results.filter((r) => r.status === 'fulfilled').length;
}

describe('B4 concurrency: accept racing withdraw / second accept / cancel / new quotes; double complete and double payment', () => {
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

  async function setup() {
    const customer = await createCustomer(t, { type: 'COMPANY' });
    const a = await solo(t);
    const co = await company(t);
    const p = await createProject(t, customer);
    const qa = await quote(t, a.token, p.id); // fee 12 000
    const qc = await quote(t, co.manager.token, p.id, { companyId: co.companyId, workers: 5, days: 3 }); // fee 15 000
    return { customer, a, co, p, qa, qc };
  }

  it('accept racing withdraw of the same quote: exactly one wins and the money matches the winner', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await t.reset();
      const { customer, a, p, qa } = await setup();
      const rev0 = await revenue(t);
      const results = await Promise.allSettled([
        t.client(customer.token).call(api.projects.acceptQuote, { params: { id: p.id, quoteId: qa.id } }),
        t.client(a.token).call(api.providerProjects.withdrawQuote, { params: { id: qa.id } }),
      ]);
      expectDomainRejections(results, ['INVALID_STATE']);
      expect(fulfilled(results)).toBe(1);
      const q = await t.prisma.quote.findUniqueOrThrow({ where: { id: qa.id } });
      const proj = await t.prisma.project.findUniqueOrThrow({ where: { id: p.id } });
      const hold = await t.prisma.hold.findFirstOrThrow({ where: { quoteId: qa.id } });
      if (results[0]!.status === 'fulfilled') {
        expect(q.status).toBe('ACCEPTED');
        expect(proj).toMatchObject({ status: 'AWARDED', awardedQuoteId: qa.id });
        expect(hold.status).toBe('CAPTURED');
        expect((await revenue(t)) - rev0).toBe(12_000);
        expect(await balanceOf(t, a.walletAccountId!)).toEqual({ posted: 88_000, held: 0, available: 88_000 });
      } else {
        expect(q.status).toBe('WITHDRAWN');
        expect(proj.status).toBe('OPEN');
        expect(hold.status).toBe('RELEASED');
        expect(await revenue(t)).toBe(rev0);
        expect(await balanceOf(t, a.walletAccountId!)).toEqual({ posted: 100_000, held: 0, available: 100_000 });
      }
      await expectLedgerSound(t);
    }
  });

  it('two accepts of different quotes at once: one award, one fee captured, the other released', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await t.reset();
      const { customer, a, co, p, qa, qc } = await setup();
      const rev0 = await revenue(t);
      const results = await Promise.allSettled([
        t.client(customer.token).call(api.projects.acceptQuote, { params: { id: p.id, quoteId: qa.id } }),
        t.client(customer.token).call(api.projects.acceptQuote, { params: { id: p.id, quoteId: qc.id } }),
      ]);
      expectDomainRejections(results, ['INVALID_STATE']);
      expect(fulfilled(results)).toBe(1);
      const winnerId = results[0]!.status === 'fulfilled' ? qa.id : qc.id;
      const proj = await t.prisma.project.findUniqueOrThrow({ where: { id: p.id } });
      expect(proj).toMatchObject({ status: 'AWARDED', awardedQuoteId: winnerId });
      const quotes = await t.prisma.quote.findMany({ where: { projectId: p.id } });
      expect(quotes.filter((q) => q.status === 'ACCEPTED').map((q) => q.id)).toEqual([winnerId]);
      expect(quotes.filter((q) => q.status === 'REJECTED')).toHaveLength(1);
      const holds = await t.prisma.hold.findMany({ where: { kind: 'B2B_QUOTE_FEE' } });
      expect(holds.filter((h) => h.status === 'CAPTURED').map((h) => h.quoteId)).toEqual([winnerId]);
      expect(holds.filter((h) => h.status === 'RELEASED')).toHaveLength(1);
      expect((await revenue(t)) - rev0).toBe(winnerId === qa.id ? 12_000 : 15_000);
      expect((await balanceOf(t, a.walletAccountId!)).held + (await balanceOf(t, co.walletAccountId)).held).toBe(0);
      expect(await t.prisma.ledgerTransaction.count({ where: { kind: 'B2B_FEE_CAPTURE' } })).toBe(1);
      await expectLedgerSound(t);
    }
  });

  it('accept racing cancel: either AWARDED with one capture, or CANCELLED with every hold released', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await t.reset();
      const { customer, p, qa } = await setup();
      const rev0 = await revenue(t);
      const results = await Promise.allSettled([
        t.client(customer.token).call(api.projects.acceptQuote, { params: { id: p.id, quoteId: qa.id } }),
        t.client(customer.token).call(api.projects.cancel, { params: { id: p.id } }),
      ]);
      expectDomainRejections(results, ['INVALID_STATE', 'CANCEL_NOT_ALLOWED']);
      expect(fulfilled(results)).toBe(1);
      const proj = await t.prisma.project.findUniqueOrThrow({ where: { id: p.id } });
      const holds = await t.prisma.hold.findMany({ where: { kind: 'B2B_QUOTE_FEE' } });
      expect(holds.some((h) => h.status === 'ACTIVE')).toBe(false);
      if (results[0]!.status === 'fulfilled') {
        expect(proj.status).toBe('AWARDED');
        expect(holds.filter((h) => h.status === 'CAPTURED')).toHaveLength(1);
        expect((await revenue(t)) - rev0).toBe(12_000);
      } else {
        expect(proj.status).toBe('CANCELLED');
        expect(holds.every((h) => h.status === 'RELEASED')).toBe(true);
        expect(await revenue(t)).toBe(rev0);
      }
      await expectLedgerSound(t);
    }
  });

  it('a new quote racing the award never leaves an active hold on an awarded project', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await t.reset();
      const { customer, p, qa } = await setup();
      const late = await solo(t);
      const results = await Promise.allSettled([
        t.client(customer.token).call(api.projects.acceptQuote, { params: { id: p.id, quoteId: qa.id } }),
        quote(t, late.token, p.id),
      ]);
      expectDomainRejections(results, ['QUOTE_WINDOW_CLOSED']);
      expect(results[0]!.status).toBe('fulfilled');
      const lateQuote = await t.prisma.quote.findFirst({ where: { projectId: p.id, handymanId: late.handymanId } });
      if (results[1]!.status === 'fulfilled') expect(lateQuote?.status).toBe('REJECTED');
      else expect(lateQuote).toBeNull();
      expect(await t.prisma.hold.count({ where: { kind: 'B2B_QUOTE_FEE', status: 'ACTIVE' } })).toBe(0);
      expect(await balanceOf(t, late.walletAccountId!)).toEqual({ posted: 100_000, held: 0, available: 100_000 });
      await expectLedgerSound(t);
    }
  });

  it('the same provider submitting twice at once (different keys) gets one quote and one hold', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await t.reset();
      const customer = await createCustomer(t);
      const a = await solo(t);
      const p = await createProject(t, customer);
      const results = await Promise.allSettled([quote(t, a.token, p.id), quote(t, a.token, p.id, { totalAmount: 450_000 })]);
      expectDomainRejections(results, ['CONFLICT']);
      expect(fulfilled(results)).toBe(1);
      expect(await t.prisma.quote.count({ where: { projectId: p.id } })).toBe(1);
      expect(await balanceOf(t, a.walletAccountId!)).toMatchObject({ held: 12_000 });
      await expectLedgerSound(t);
    }
  });

  it('one provider quoting on two projects while both customers award at once does not deadlock', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await t.reset();
      const c1 = await createCustomer(t);
      const c2 = await createCustomer(t);
      const a = await solo(t);
      const b = await solo(t);
      const p1 = await createProject(t, c1);
      const p2 = await createProject(t, c2);
      const a1 = await quote(t, a.token, p1.id);
      await quote(t, b.token, p1.id);
      await quote(t, a.token, p2.id);
      const b2 = await quote(t, b.token, p2.id);
      const results = await Promise.allSettled([
        t.client(c1.token).call(api.projects.acceptQuote, { params: { id: p1.id, quoteId: a1.id } }),
        t.client(c2.token).call(api.projects.acceptQuote, { params: { id: p2.id, quoteId: b2.id } }),
      ]);
      expectDomainRejections(results, []);
      expect(fulfilled(results)).toBe(2);
      expect(await balanceOf(t, a.walletAccountId!)).toEqual({ posted: 88_000, held: 0, available: 88_000 });
      expect(await balanceOf(t, b.walletAccountId!)).toEqual({ posted: 88_000, held: 0, available: 88_000 });
      await expectLedgerSound(t);
    }
  });

  it('double complete (different keys) issues one invoice; double mark-paid credits earnings once', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await t.reset();
      const { customer, a, p, qa } = await setup();
      await t.client(customer.token).call(api.projects.acceptQuote, { params: { id: p.id, quoteId: qa.id } });
      const done = await Promise.allSettled([
        t.client(a.token).call(api.providerProjects.complete, { params: { id: p.id }, body: {} }),
        t.client(a.token).call(api.providerProjects.complete, { params: { id: p.id }, body: {} }),
      ]);
      expectDomainRejections(done, ['INVALID_STATE']);
      expect(fulfilled(done)).toBe(1);
      expect(await t.prisma.invoice.count()).toBe(1);
      const inv = await t.prisma.invoice.findFirstOrThrow();
      const admin = await adminToken(t);
      const paid = await Promise.allSettled([
        t.client(admin.token).call(api.admin.markInvoicePaid, { params: { id: inv.id } }),
        t.client(admin.token).call(api.admin.markInvoicePaid, { params: { id: inv.id } }),
      ]);
      expectDomainRejections(paid, ['INVALID_STATE']);
      expect(fulfilled(paid)).toBe(1);
      expect(await balanceOf(t, a.earningsAccountId!)).toMatchObject({ posted: 500_000 });
      expect(await t.prisma.auditLog.count({ where: { action: 'invoice.markPaid' } })).toBe(1);
      await expectLedgerSound(t);
    }
  });
});
