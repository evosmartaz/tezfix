import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api } from '@tezfiks/shared';
import { createTestApp, type TestApp } from '../helpers/app';
import { BAKU, createSoloHandyman } from '../helpers/factories';
import { admin, advance, assignmentRow, bal, companyJob, expectLedgerSound, goOnline, setSettings, soloJob, toPriceProposed } from './helpers';

describe('B3 admin block of a handyman / company: running jobs are force-cancelled (ADMIN) and re-dispatched', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
    await setSettings(t, { minCandidates: 0 });
  });

  it('blocking a solo handyman: its en-route job is cancelled without fees and the slot is offered to another pro', async () => {
    const job = await soloJob(t, { proBalance: 2000, customerBalance: 1000, emergency: true });
    await advance(t, 301_000); // fee + emergency fee captured
    await t.client(job.h.token).call(api.pro.enRoute, { params: { id: job.assignmentId }, body: { location: BAKU.narimanov } });
    const other = await createSoloHandyman(t, { balance: 2000 });
    await goOnline(t, other.handymanId, BAKU.center);
    expect(await bal(t, job.h.walletAccountId!)).toMatchObject({ posted: 1000 });
    expect(await bal(t, job.c.walletAccountId)).toMatchObject({ posted: 500 });

    const { token } = await admin(t);
    await t.client(token).call(api.admin.blockHandyman, { params: { id: job.h.handymanId }, body: { reason: 'Saxta sənədlər' } });

    const a = await assignmentRow(t, job.assignmentId);
    expect(a).toMatchObject({ status: 'CANCELLED_FREE', cancelledBy: 'ADMIN' });
    expect(a.cancelReason).toBeTruthy();
    // No fee kept from the blocked pro's job, the customer's emergency fee is given back, no penalty, no strike.
    expect(await bal(t, job.h.walletAccountId!)).toMatchObject({ posted: 2000, held: 0 });
    expect(await bal(t, job.c.walletAccountId)).toMatchObject({ posted: 1000, held: 0 });
    expect((await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: job.h.handymanId } })).strikes).toBe(0);
    // The request is searching again and another pro got an offer.
    const r = await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: job.requestId }, include: { slots: true } });
    expect(r).toMatchObject({ status: 'SEARCHING', isSearching: true, cancelledAt: null, cancelledBy: null });
    expect(r.slots[0]).toMatchObject({ status: 'OPEN', currentAssignmentId: null });
    expect(await t.prisma.offer.count({ where: { requestId: job.requestId, handymanId: other.handymanId, status: 'SENT' } })).toBe(1);
    expect(await t.prisma.offer.count({ where: { requestId: job.requestId, handymanId: job.h.handymanId, status: 'SENT' } })).toBe(0);
    expect(await t.prisma.notification.count({ where: { userId: job.c.userId, type: 'ASSIGNMENT_CANCELLED' } })).toBe(1);
    // The other pro accepts; the customer is served (no second emergency charge).
    const offer = await t.prisma.offer.findFirstOrThrow({ where: { requestId: job.requestId, handymanId: other.handymanId } });
    await t.client(other.token).call(api.pro.acceptOffer, { params: { id: offer.id } });
    expect((await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: job.requestId } })).status).toBe('ASSIGNED');
    await advance(t, 301_000);
    expect(await bal(t, job.c.walletAccountId)).toMatchObject({ posted: 1000, held: 0 });
    await expectLedgerSound(t);
  });

  it('a job with a proposed price is left alone (the work is done; the customer can still pay or dispute)', async () => {
    const job = await soloJob(t);
    await toPriceProposed(t, job);
    const { token } = await admin(t);
    await t.client(token).call(api.admin.blockHandyman, { params: { id: job.h.handymanId }, body: { reason: 'Şikayətlər' } });
    expect((await assignmentRow(t, job.assignmentId)).status).toBe('PRICE_PROPOSED');
    const out = await t.client(job.c.token).call(api.assignments.confirmPrice, { params: { id: job.assignmentId }, body: { method: 'CASH' } });
    expect(out.assignment.status).toBe('COMPLETED');
  });

  it('blocking a company: its workers\' running jobs are cancelled and re-dispatched; the company wallet hold is released', async () => {
    const job = await companyJob(t, { balance: 5000 });
    expect(await bal(t, job.co.walletAccountId)).toEqual({ posted: 5000, held: 1000, available: 4000 });
    const other = await createSoloHandyman(t, { balance: 2000 });
    await goOnline(t, other.handymanId, BAKU.center);
    const { token } = await admin(t);
    await t.client(token).call(api.admin.blockCompany, { params: { id: job.co.companyId }, body: { reason: 'Lisenziya yoxdur' } });
    expect(await assignmentRow(t, job.assignmentId)).toMatchObject({ status: 'CANCELLED_FREE', cancelledBy: 'ADMIN' });
    expect(await bal(t, job.co.walletAccountId)).toEqual({ posted: 5000, held: 0, available: 5000 });
    expect((await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: job.requestId } })).status).toBe('SEARCHING');
    expect(await t.prisma.offer.count({ where: { requestId: job.requestId, handymanId: other.handymanId } })).toBe(1);
    await expectLedgerSound(t);
  });

  it('blocking the user account of a pro does the same', async () => {
    const job = await soloJob(t);
    const { token } = await admin(t);
    await t.client(token).call(api.admin.blockUser, { params: { id: job.h.userId }, body: { reason: 'Fırıldaqçılıq' } });
    expect(await assignmentRow(t, job.assignmentId)).toMatchObject({ status: 'CANCELLED_FREE', cancelledBy: 'ADMIN' });
    expect(await bal(t, job.h.walletAccountId!)).toEqual({ posted: 2000, held: 0, available: 2000 });
    await expectLedgerSound(t);
  });
});
