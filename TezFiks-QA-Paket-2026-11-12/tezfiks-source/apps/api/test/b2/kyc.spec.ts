import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { api } from '@tezfiks/shared';
import { translate } from '@tezfiks/i18n/server';
import { createTestApp, type TestApp } from '../helpers/app';
import { adminToken, createCompany, createSoloHandyman, tokenFor } from '../helpers/factories';
import { DomainEvents, type DomainEventMap } from '../../src/infra/events';
import { FilesService } from '../../src/modules/files/files.service';
import { kycBody, onboardCompany, onboardSolo, proUser, upload } from './helpers';

const DAY = 24 * 60 * 60_000;

function localUrl(t: TestApp, url: string): string {
  const u = new URL(url);
  return `${t.origin}${u.pathname}${u.search}`;
}

describe('B2 KYC: submission, admin review, resubmit limit, access logging', () => {
  let t: TestApp;
  const statusEvents: Array<DomainEventMap['handyman.status'] | DomainEventMap['company.status']> = [];
  beforeAll(async () => {
    t = await createTestApp();
    const events = t.app.get(DomainEvents);
    events.on('handyman.status', (e) => {
      statusEvents.push(e);
    });
    events.on('company.status', (e) => {
      statusEvents.push(e);
    });
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
    statusEvents.length = 0;
  });

  it('solo end to end: upload, submit (consent stored), pending, admin approve with extracted fields', async () => {
    const u = await proUser(t);
    const profile = await onboardSolo(t, u);
    const body = await kycBody(t, u.token, { tradeProofs: 2 });
    const status = await t.client(u.token).call(api.kyc.submit, { body });
    expect(status).toMatchObject({ status: 'PENDING_REVIEW', reviewedAt: null, rejectReason: null, attemptsLeft24h: 2 });
    expect(status.submittedAt).not.toBeNull();
    expect(await t.client(u.token).call(api.kyc.status)).toEqual(status);

    const sub = await t.prisma.verificationSubmission.findFirstOrThrow({ where: { handymanId: profile.id } });
    const consent = translate('az', 'server.providers.consentText');
    expect(consent.length).toBeGreaterThan(50);
    expect(sub).toMatchObject({
      subject: 'HANDYMAN',
      submittedByUserId: u.userId,
      status: 'PENDING_REVIEW',
      consentPolicyVersion: 'kyc-2026-10',
      consentLocale: 'az',
      consentTextHash: createHash('sha256').update(consent, 'utf8').digest('hex'),
      idFrontFileId: body.idFrontFileId,
      tradeProofFileIds: body.tradeProofFileIds,
    });
    expect(sub.consentIp).toBeTruthy();
    expect(sub.selfieChecks).toMatchObject({ turn: { rotationY: 32 } });
    expect(t.realtime.sentTo('admins', 'admin:event')).toEqual([
      expect.objectContaining({ payload: { type: 'KYC_SUBMITTED', entityId: profile.id } }),
    ]);
    const pending = await t.client(u.token).call(api.pro.profile);
    expect(pending.profile).toMatchObject({ status: 'PENDING_REVIEW', kyc: { status: 'PENDING_REVIEW' } });

    await expect(t.client(u.token).call(api.kyc.submit, { body })).rejects.toMatchObject({ code: 'KYC_ALREADY_PENDING', status: 409 });

    const admin = await adminToken(t);
    const detail = await t.client(admin.token).call(api.admin.approveHandyman, {
      params: { id: profile.id },
      body: { extracted: { docNumberLast4: '4F7K', birthDate: '1990-05-17', expiry: '2031-01-31' } },
    });
    expect(detail.row).toMatchObject({ id: profile.id, status: 'APPROVED', displayStatus: 'LOW_BALANCE' });
    expect(detail.kyc).toMatchObject({
      submissionId: sub.id,
      status: 'APPROVED',
      extracted: { docNumberLast4: '4F7K', birthDate: '1990-05-17', expiry: '2031-01-31' },
      reviewerName: 'Test Admin',
      consent: { policyVersion: 'kyc-2026-10', locale: 'az' },
    });
    expect(detail.kyc!.files.tradeProofs).toHaveLength(2);

    const approved = await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: profile.id } });
    expect(approved.status).toBe('APPROVED');
    expect(approved.approvedAt).not.toBeNull();
    const files = await t.prisma.file.findMany({ where: { id: { in: [body.idFrontFileId, body.selfie.blinkFileId, ...body.tradeProofFileIds] } } });
    for (const f of files) {
      expect(Math.abs(f.purgeAfter!.getTime() - (t.clock.nowMs() + 30 * DAY))).toBeLessThan(5_000);
    }
    const notes = await t.prisma.notification.findMany({ where: { userId: u.userId, type: 'KYC_APPROVED' } });
    expect(notes).toHaveLength(1);
    expect(t.realtime.sentTo(`user:${u.userId}`, 'profile:updated').map((e) => e.payload)).toContainEqual({ reason: 'KYC_APPROVED' });
    expect(statusEvents).toContainEqual({ handymanId: profile.id, userId: u.userId, status: 'APPROVED' });
    const audit = await t.prisma.auditLog.findMany({ where: { entityId: profile.id, action: 'handyman.approve' } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorType: 'ADMIN', actorId: admin.adminId });

    // Approved profiles cannot submit again; a second decision is refused.
    await expect(t.client(u.token).call(api.kyc.submit, { body: await kycBody(t, u.token) })).rejects.toMatchObject({
      code: 'INVALID_STATE',
      status: 409,
    });
    await expect(t.client(admin.token).call(api.admin.approveHandyman, { params: { id: profile.id }, body: {} })).rejects.toMatchObject({
      code: 'INVALID_STATE',
      status: 409,
    });
    await expect(
      t.client(admin.token).call(api.admin.rejectHandyman, { params: { id: profile.id }, body: { reason: 'Şəkil aydın deyil' } }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE', status: 409 });
  });

  it('reject with a reason, resubmit, max 3 submissions per 24 h (KYC_RESUBMIT_LIMIT), allowed again after 24 h', async () => {
    const u = await proUser(t);
    const profile = await onboardSolo(t, u);
    const admin = await adminToken(t);
    // Access tokens live 15 minutes: issue fresh ones after moving the clock.
    const pro = async () => t.client(await tokenFor(t, u.userId, 'PRO'));
    const adm = async () => t.client((await t.sessions.createAdminSession(admin.adminId, 'ADMIN')).accessToken);
    for (let i = 0; i < 3; i++) {
      const token = await tokenFor(t, u.userId, 'PRO');
      const st = await t.client(token).call(api.kyc.submit, { body: await kycBody(t, token) });
      expect(st.attemptsLeft24h).toBe(2 - i);
      const d = await (await adm()).call(api.admin.rejectHandyman, { params: { id: profile.id }, body: { reason: 'Şəxsiyyət vəsiqəsi oxunmur' } });
      expect(d.rejectReason).toBe('Şəxsiyyət vəsiqəsi oxunmur');
      expect(d.kyc).toMatchObject({ status: 'REJECTED', rejectReason: 'Şəxsiyyət vəsiqəsi oxunmur', reviewerName: 'Test Admin' });
      t.clock.advance(60 * 60_000);
    }
    const st = await (await pro()).call(api.kyc.status);
    expect(st).toMatchObject({ status: 'REJECTED', rejectReason: 'Şəxsiyyət vəsiqəsi oxunmur', attemptsLeft24h: 0 });
    const notes = await t.prisma.notification.findMany({ where: { userId: u.userId, type: 'KYC_REJECTED' } });
    expect(notes).toHaveLength(3);
    expect(notes[0]!.body).toContain('Şəxsiyyət vəsiqəsi oxunmur');
    expect(statusEvents.filter((e) => 'handymanId' in e && e.status === 'REJECTED')).toHaveLength(3);

    const token = await tokenFor(t, u.userId, 'PRO');
    const body = await kycBody(t, token);
    await expect(t.client(token).call(api.kyc.submit, { body })).rejects.toMatchObject({ code: 'KYC_RESUBMIT_LIMIT', status: 429 });
    expect((await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: profile.id } })).status).toBe('REJECTED');

    // Submissions were at ~0 h, ~1 h, ~2 h; now ~25 h: only the ~2 h one is still inside the window.
    t.clock.advance(22 * 60 * 60_000);
    const again = await (await pro()).call(api.kyc.submit, { body });
    expect(again).toMatchObject({ status: 'PENDING_REVIEW', rejectReason: null, attemptsLeft24h: 1 });
    expect((await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: profile.id } })).rejectReason).toBeNull();
  });

  it('rejected KYC files are also scheduled for purge 30 days after the decision', async () => {
    const u = await proUser(t);
    const profile = await onboardSolo(t, u);
    const body = await kycBody(t, u.token);
    await t.client(u.token).call(api.kyc.submit, { body });
    const admin = await adminToken(t);
    await t.client(admin.token).call(api.admin.rejectHandyman, { params: { id: profile.id }, body: { reason: 'Selfi bulanıqdır' } });
    const f = await t.prisma.file.findUniqueOrThrow({ where: { id: body.idBackFileId } });
    expect(Math.abs(f.purgeAfter!.getTime() - (t.clock.nowMs() + 30 * DAY))).toBeLessThan(5_000);
  });

  it("FILE_NOT_OWNED for another user's file or a file of the wrong kind; nothing is created", async () => {
    const u = await proUser(t);
    const profile = await onboardSolo(t, u);
    const other = await proUser(t);
    const body = await kycBody(t, u.token);
    const foreign = await upload(t, other.token, 'KYC_ID_FRONT');
    await expect(t.client(u.token).call(api.kyc.submit, { body: { ...body, idFrontFileId: foreign.id } })).rejects.toMatchObject({
      code: 'FILE_NOT_OWNED',
      status: 403,
    });
    await expect(t.client(u.token).call(api.kyc.submit, { body: { ...body, idFrontFileId: body.idBackFileId } })).rejects.toMatchObject({
      code: 'FILE_NOT_OWNED',
      status: 403,
    });
    const notProof = await upload(t, u.token, 'PROFILE_PHOTO');
    await expect(t.client(u.token).call(api.kyc.submit, { body: { ...body, tradeProofFileIds: [notProof.id] } })).rejects.toMatchObject({
      code: 'FILE_NOT_OWNED',
    });
    expect(await t.prisma.verificationSubmission.count()).toBe(0);
    expect((await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: profile.id } })).status).toBe('DRAFT');
  });

  it('NOT_FOUND without a profile; INVALID_STATE for company workers and blocked profiles; consent must be accepted', async () => {
    const u = await proUser(t);
    await expect(t.client(u.token).call(api.kyc.submit, { body: await kycBody(t, u.token) })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    expect(await t.client(u.token).call(api.kyc.status)).toEqual({ status: 'NONE', submittedAt: null, reviewedAt: null, rejectReason: null, attemptsLeft24h: 3 });

    const c = await createCompany(t, { workers: 1 });
    const w = c.workers[0]!;
    await expect(t.client(w.token).call(api.kyc.submit, { body: await kycBody(t, w.token) })).rejects.toMatchObject({
      code: 'INVALID_STATE',
      details: { reason: 'COMPANY_WORKER' },
    });
    const blocked = await createSoloHandyman(t, { status: 'BLOCKED' });
    await expect(t.client(blocked.token).call(api.kyc.submit, { body: await kycBody(t, blocked.token) })).rejects.toMatchObject({
      code: 'INVALID_STATE',
      status: 409,
    });

    const d = await proUser(t);
    await onboardSolo(t, d);
    const body = await kycBody(t, d.token);
    await expect(
      t.client(d.token).call(api.kyc.submit, { body: { ...body, consent: { ...body.consent, accepted: false as never } } }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
  });

  it('two concurrent submissions: one wins, the other gets KYC_ALREADY_PENDING', async () => {
    const u = await proUser(t);
    await onboardSolo(t, u);
    const [a, b] = await Promise.all([kycBody(t, u.token), kycBody(t, u.token)]);
    const results = await Promise.allSettled([t.client(u.token).call(api.kyc.submit, { body: a }), t.client(u.token).call(api.kyc.submit, { body: b })]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ code: 'KYC_ALREADY_PENDING' });
    expect(await t.prisma.verificationSubmission.count()).toBe(1);
  });

  it('company KYC by a manager, admin approve / reject company, NOT_COMPANY_MANAGER for others', async () => {
    const m = await proUser(t);
    const company = await onboardCompany(t, m);
    const body = await kycBody(t, m.token, { subject: 'COMPANY', companyId: company.id, companyDocs: 2 });
    const outsider = await proUser(t);
    await expect(
      t.client(outsider.token).call(api.kyc.submit, { body: await kycBody(t, outsider.token, { subject: 'COMPANY', companyId: company.id }) }),
    ).rejects.toMatchObject({ code: 'NOT_COMPANY_MANAGER', status: 403 });
    await expect(t.client(outsider.token).call(api.kyc.status, { query: { companyId: company.id } })).rejects.toMatchObject({
      code: 'NOT_COMPANY_MANAGER',
    });
    await expect(
      t.client(m.token).call(api.kyc.submit, { body: { ...body, companyId: undefined } }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });

    const st = await t.client(m.token).call(api.kyc.submit, { body });
    expect(st).toMatchObject({ status: 'PENDING_REVIEW', attemptsLeft24h: 2 });
    expect(await t.client(m.token).call(api.kyc.status, { query: { companyId: company.id } })).toEqual(st);
    expect(t.realtime.sentTo('admins', 'admin:event').map((e) => e.payload)).toContainEqual({ type: 'COMPANY_KYC_SUBMITTED', entityId: company.id });
    const view = await t.client(m.token).call(api.company.get, { params: { companyId: company.id } });
    expect(view).toMatchObject({ status: 'PENDING_REVIEW', kyc: { status: 'PENDING_REVIEW' } });

    const admin = await adminToken(t);
    const rejected = await t.client(admin.token).call(api.admin.rejectCompany, { params: { id: company.id }, body: { reason: 'VÖEN sənədi yoxdur' } });
    expect(rejected).toMatchObject({ rejectReason: 'VÖEN sənədi yoxdur', row: { status: 'REJECTED' }, kyc: { status: 'REJECTED' } });
    expect(rejected.kyc!.files.companyDocs).toHaveLength(2);
    const rejectNote = await t.prisma.notification.findFirstOrThrow({ where: { userId: m.userId, type: 'COMPANY_REJECTED' } });
    expect(rejectNote.body).toContain('VÖEN sənədi yoxdur');

    await t.client(m.token).call(api.kyc.submit, { body: await kycBody(t, m.token, { subject: 'COMPANY', companyId: company.id }) });
    const approved = await t.client(admin.token).call(api.admin.approveCompany, { params: { id: company.id } });
    expect(approved).toMatchObject({ row: { status: 'APPROVED', ownerName: 'Fuad İdarəçi' }, rejectReason: null, kyc: { status: 'APPROVED' } });
    expect(await t.prisma.notification.count({ where: { userId: m.userId, type: 'COMPANY_APPROVED' } })).toBe(1);
    expect(statusEvents).toContainEqual({ companyId: company.id, status: 'APPROVED' });
    expect((await t.prisma.company.findUniqueOrThrow({ where: { id: company.id } })).approvedAt).not.toBeNull();
    await expect(t.client(admin.token).call(api.admin.approveCompany, { params: { id: company.id } })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(
      t.client(m.token).call(api.kyc.submit, { body: await kycBody(t, m.token, { subject: 'COMPANY', companyId: company.id }) }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('admin KYC views use admin-signed URLs, every view is logged in kyc_access_logs, and users cannot see them', async () => {
    const u = await proUser(t);
    const profile = await onboardSolo(t, u);
    const body = await kycBody(t, u.token, { tradeProofs: 1 });
    await t.client(u.token).call(api.kyc.submit, { body });
    const admin = await adminToken(t);
    const detail = await t.client(admin.token).call(api.admin.handyman, { params: { id: profile.id } });
    const files = detail.kyc!.files;
    const all = [files.idFront, files.idBack, files.selfieFront, files.selfieTurn, files.selfieBlink, ...files.tradeProofs];
    expect(all.map((f) => f.id).sort()).toEqual(
      [body.idFrontFileId, body.idBackFileId, body.selfie.frontFileId, body.selfie.turnFileId, body.selfie.blinkFileId, ...body.tradeProofFileIds].sort(),
    );
    for (const f of all) expect(decodeURIComponent(new URL(f.url).searchParams.get('sig')!)).toMatch(new RegExp(`^${admin.adminId}\\.`));
    const logs = await t.prisma.kycAccessLog.findMany({ where: { adminId: admin.adminId } });
    expect(logs.map((l) => l.fileId).sort()).toEqual(all.map((f) => f.id).sort());

    await t.client(admin.token).call(api.admin.handyman, { params: { id: profile.id } });
    expect(await t.prisma.kycAccessLog.count({ where: { adminId: admin.adminId } })).toBe(all.length * 2);

    const res = await fetch(localUrl(t, files.idFront.url));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(await t.prisma.kycAccessLog.count({ where: { adminId: admin.adminId, fileId: files.idFront.id } })).toBe(3);

    // A user-signed URL for a KYC file never works (admin only), and users cannot call admin endpoints.
    const own = await t.prisma.file.findUniqueOrThrow({ where: { id: body.idFrontFileId } });
    expect(own.kind).toBe('KYC_ID_FRONT');
    const logsBefore = await t.prisma.kycAccessLog.count();
    // the URL the uploader got back from api.files.upload
    const uploaded = await upload(t, u.token, 'KYC_ID_FRONT', 42);
    const asUser = await fetch(localUrl(t, uploaded.url));
    expect(asUser.status).toBe(403);
    expect(await asUser.json()).toMatchObject({ error: { code: 'FORBIDDEN', details: { reason: 'ADMIN_ONLY' } } });
    // a URL signed without an admin for the submitted file itself
    const plain = await fetch(localUrl(t, t.app.get(FilesService).signedUrl(own)));
    expect(plain.status).toBe(403);
    // the admin signature cannot be moved to another file, nor its expiry stretched
    const adminUrl = new URL(files.idFront.url);
    const moved = await fetch(localUrl(t, files.idFront.url.replace(files.idFront.id, files.idBack.id)));
    expect(moved.status).toBe(403);
    adminUrl.searchParams.set('exp', String(Number(adminUrl.searchParams.get('exp')) + 3600));
    expect((await fetch(localUrl(t, adminUrl.toString()))).status).toBe(403);
    expect(await t.prisma.kycAccessLog.count()).toBe(logsBefore);
    await expect(t.client(u.token).call(api.admin.handyman, { params: { id: profile.id } })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    await expect(t.client().call(api.admin.handymen, { query: {} })).rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401 });
  });

  it('admin decisions on unknown ids -> NOT_FOUND', async () => {
    const admin = await adminToken(t);
    const id = crypto.randomUUID();
    const c = t.client(admin.token);
    await expect(c.call(api.admin.handyman, { params: { id } })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    await expect(c.call(api.admin.approveHandyman, { params: { id }, body: {} })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(c.call(api.admin.rejectHandyman, { params: { id }, body: { reason: 'yoxdur' } })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(c.call(api.admin.company, { params: { id } })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(c.call(api.admin.approveCompany, { params: { id } })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(c.call(api.admin.rejectCompany, { params: { id }, body: { reason: 'yoxdur' } })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(c.call(api.admin.blockUser, { params: { id }, body: { reason: 'yoxdur' } })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
