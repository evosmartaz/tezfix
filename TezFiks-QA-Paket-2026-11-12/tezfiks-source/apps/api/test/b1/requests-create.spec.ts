import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { latLngToCell } from 'h3-js';
import { api } from '@tezfiks/shared';
import { createTestApp, type TestApp } from '../helpers/app';
import { BAKU, categoryId, createCustomer, createUser, fund, tokenFor } from '../helpers/factories';
import { ANTHROPIC_CLIENT } from '../../src/modules/ai/ai.service';
import { RequestsService } from '../../src/modules/requests/requests.service';
import { RateLimiter } from '../../src/infra/rate-limiter';
import { MeService } from '../../src/modules/users/me.service';
import { createFakeAnthropic } from '../a4/helpers';
import { addressAt, createRequest, expectLedgerSound, requestBody, setSettings, upload } from './helpers';

describe('B1 request creation, list, get and classify-photo', () => {
  let t: TestApp;
  const ai = createFakeAnthropic();
  beforeAll(async () => {
    t = await createTestApp((b) => b.overrideProvider(ANTHROPIC_CLIENT).useValue(ai.client));
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
    ai.reset();
  });

  it('creates a NOW request: address snapshot with cells, slots, SEARCHING detail', async () => {
    const c = await createCustomer(t, { balance: 0 });
    const out = await createRequest(t, c, { slots: 2, address: addressAt(BAKU.center, { street: 'Şəhriyar küçəsi', district: 'Nəsimi' }) });
    expect(out).toMatchObject({
      number: 1000,
      status: 'SEARCHING',
      timing: 'NOW',
      slotsRequested: 2,
      slotsFilled: 0,
      isSearching: true,
      isGuaranteeFix: false,
      providerPreference: 'ANY',
      emergencyFee: null,
      canCancel: true,
      cancelPenaltyPreview: 0,
      assignments: [],
      category: { slug: 'plumbing' },
    });
    expect(out.slots).toEqual([
      { index: 0, status: 'OPEN', assignmentId: null },
      { index: 1, status: 'OPEN', assignmentId: null },
    ]);
    expect(out.address).toMatchObject({ street: 'Şəhriyar küçəsi', district: 'Nəsimi', apartment: 'mənzil 45', entrance: '2-ci giriş' });
    expect(out.search).toMatchObject({ step: 0, ring: 0, wide: false, cells: [latLngToCell(BAKU.center.lat, BAKU.center.lng, 7)], offersSent: 0 });
    const row = await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: out.id } });
    expect(row.cell7).toBe(latLngToCell(BAKU.center.lat, BAKU.center.lng, 7));
    expect(row.cell9).toBe(latLngToCell(BAKU.center.lat, BAKU.center.lng, 9));
    expect(row.searchEndsAt!.getTime() - row.searchStartedAt!.getTime()).toBe(180_000);
    expect(t.jobs.pending('dispatch.end')).toHaveLength(1);
  });

  it('requires a customer account', async () => {
    const u = await createUser(t);
    const token = await tokenFor(t, u.userId, 'CUSTOMER');
    await expect(t.client(token).call(api.requests.create, { body: await requestBody(t) })).rejects.toMatchObject({
      code: 'CUSTOMER_ACCOUNT_REQUIRED',
      status: 409,
    });
  });

  it('a customer in debt cannot create requests (CUSTOMER_IN_DEBT)', async () => {
    const c = await createCustomer(t);
    const revenue = await t.ledger.platformAccountId('REVENUE');
    await t.ledger.post({
      kind: 'CANCEL_PENALTY',
      idempotencyKey: 'debt-test',
      entries: [
        { accountId: c.walletAccountId, amount: -1500 },
        { accountId: revenue, amount: 1500 },
      ],
      allowOverdraft: [c.walletAccountId],
    });
    await expect(createRequest(t, c)).rejects.toMatchObject({ code: 'CUSTOMER_IN_DEBT', status: 402 });
    await fund(t, c.walletAccountId, 1500);
    await expect(createRequest(t, c)).resolves.toMatchObject({ status: 'SEARCHING' });
    await expectLedgerSound(t);
  });

  it('category checks: group -> VALIDATION_FAILED, quote flow -> CATEGORY_REQUIRES_QUOTE, inactive -> CATEGORY_INACTIVE, unknown -> NOT_FOUND', async () => {
    const c = await createCustomer(t);
    await expect(createRequest(t, c, { slug: 'home-systems' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(createRequest(t, c, { slug: 'renovation-crew' })).rejects.toMatchObject({ code: 'CATEGORY_REQUIRES_QUOTE', status: 400 });
    await t.prisma.category.update({ where: { slug: 'tiling' }, data: { active: false } });
    await expect(createRequest(t, c, { slug: 'tiling' })).rejects.toMatchObject({ code: 'CATEGORY_INACTIVE', status: 400 });
    await expect(createRequest(t, c, { categoryId: crypto.randomUUID() })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await t.prisma.serviceRequest.count()).toBe(0);
  });

  it('photos: must be own REQUEST_PHOTO files, at most maxPhotos', async () => {
    const c = await createCustomer(t);
    const other = await createCustomer(t);
    const mine = await upload(t, c.token, 'REQUEST_PHOTO');
    const profile = await upload(t, c.token, 'PROFILE_PHOTO');
    const theirs = await upload(t, other.token, 'REQUEST_PHOTO');
    await expect(createRequest(t, c, { photoFileIds: [theirs.id] })).rejects.toMatchObject({ code: 'FILE_NOT_OWNED', status: 403 });
    await expect(createRequest(t, c, { photoFileIds: [profile.id] })).rejects.toMatchObject({ code: 'FILE_NOT_OWNED' });
    await setSettings(t, { maxPhotos: 1 });
    const second = await upload(t, c.token, 'REQUEST_PHOTO');
    await expect(createRequest(t, c, { photoFileIds: [mine.id, second.id] })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const ok = await createRequest(t, c, { photoFileIds: [mine.id] });
    expect(ok.photos.map((p) => p.id)).toEqual([mine.id]);
  });

  it('slots above maxSlots -> VALIDATION_FAILED', async () => {
    const c = await createCustomer(t);
    await setSettings(t, { maxSlots: 3 });
    await expect(createRequest(t, c, { slots: 4 })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(createRequest(t, c, { slots: 3 })).resolves.toMatchObject({ slotsRequested: 3 });
  });

  it('INDIVIDUAL customers are forced to providerPreference ANY; company customers keep their choice', async () => {
    const ind = await createCustomer(t);
    const co = await createCustomer(t, { type: 'COMPANY' });
    expect((await createRequest(t, ind, { providerPreference: 'COMPANY' })).providerPreference).toBe('ANY');
    expect((await createRequest(t, co, { providerPreference: 'INDIVIDUAL' })).providerPreference).toBe('INDIVIDUAL');
    expect((await createRequest(t, co, { providerPreference: 'COMPANY' })).providerPreference).toBe('COMPANY');
  });

  it('EMERGENCY holds emergencyFeePerSlot per slot (one hold per slot with slotId)', async () => {
    const c = await createCustomer(t, { balance: 2000 });
    const out = await createRequest(t, c, { timing: 'EMERGENCY', slots: 3 });
    expect(out.emergencyFee).toEqual({ perSlot: 500, total: 1500, captured: 0 });
    const holds = await t.prisma.hold.findMany({ where: { requestId: out.id }, orderBy: { createdAt: 'asc' } });
    expect(holds).toHaveLength(3);
    const slots = await t.prisma.requestSlot.findMany({ where: { requestId: out.id }, orderBy: { index: 'asc' } });
    expect(holds.map((h) => h.slotId).sort()).toEqual(slots.map((s) => s.id).sort());
    for (const s of slots) expect(holds.find((h) => h.id === s.emergencyHoldId)).toMatchObject({ kind: 'EMERGENCY_FEE', status: 'ACTIVE', amount: 500n });
    expect(await t.ledger.balance(c.walletAccountId)).toEqual({ posted: 2000, held: 1500, available: 500 });
    expect(out.search).toMatchObject({ step: 0, ring: 1, cells: expect.any(Array) });
    expect(out.search!.cells).toHaveLength(7);
    await expectLedgerSound(t);
  });

  it('EMERGENCY with insufficient balance creates nothing (INSUFFICIENT_BALANCE)', async () => {
    const c = await createCustomer(t, { balance: 900 });
    await expect(createRequest(t, c, { timing: 'EMERGENCY', slots: 2 })).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE', status: 402 });
    expect(await t.prisma.serviceRequest.count()).toBe(0);
    expect(await t.prisma.requestSlot.count()).toBe(0);
    expect(await t.prisma.hold.count()).toBe(0);
    expect(await t.ledger.balance(c.walletAccountId)).toEqual({ posted: 900, held: 0, available: 900 });
  });

  it('EMERGENCY is refused for categories without emergencyAllowed', async () => {
    const c = await createCustomer(t, { balance: 5000 });
    await expect(createRequest(t, c, { timing: 'EMERGENCY', slug: 'gardening' })).rejects.toMatchObject({ code: 'EMERGENCY_NOT_ALLOWED', status: 400 });
    expect(await t.prisma.hold.count()).toBe(0);
  });

  it('SCHEDULED bounds: SCHEDULE_TOO_SOON below the lead time, SCHEDULE_TOO_FAR beyond max days', async () => {
    const c = await createCustomer(t);
    const now = t.clock.nowMs();
    await expect(createRequest(t, c, { timing: 'SCHEDULED', scheduledAt: new Date(now + 29 * 60_000).toISOString() })).rejects.toMatchObject({
      code: 'SCHEDULE_TOO_SOON',
      status: 400,
    });
    await expect(createRequest(t, c, { timing: 'SCHEDULED', scheduledAt: new Date(now + 31 * 86_400_000).toISOString() })).rejects.toMatchObject({
      code: 'SCHEDULE_TOO_FAR',
    });
    await expect(createRequest(t, c, { timing: 'SCHEDULED' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const ok = await createRequest(t, c, { timing: 'SCHEDULED', scheduledAt: new Date(now + 3 * 3600_000).toISOString() });
    expect(ok).toMatchObject({ timing: 'SCHEDULED', status: 'SEARCHING', search: null });
  });

  it('saveAddressLabel saves the address to the address book', async () => {
    const c = await createCustomer(t);
    await createRequest(t, c, { saveAddressLabel: 'Bağ evi' });
    const saved = await t.client(c.token).call(api.customer.listAddresses);
    expect(saved.items).toHaveLength(1);
    expect(saved.items[0]).toMatchObject({ label: 'Bağ evi', apartment: 'mənzil 45' });
  });

  it('list (active/history, cursor) and get are owner-only', async () => {
    const c = await createCustomer(t);
    const other = await createCustomer(t);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await createRequest(t, c)).id);
    await t.prisma.serviceRequest.update({ where: { id: ids[0] }, data: { status: 'EXPIRED', isSearching: false } });
    const client = t.client(c.token);
    const page1 = await client.call(api.requests.list, { query: { limit: 2 } });
    expect(page1.items.map((r) => r.id)).toEqual([ids[2], ids[1]]);
    const page2 = await client.call(api.requests.list, { query: { limit: 2, cursor: page1.nextCursor! } });
    expect(page2.items.map((r) => r.id)).toEqual([ids[0]]);
    expect(page2.nextCursor).toBeNull();
    expect((await client.call(api.requests.list, { query: { scope: 'active' } })).items).toHaveLength(2);
    expect((await client.call(api.requests.list, { query: { scope: 'history' } })).items.map((r) => r.id)).toEqual([ids[0]]);
    expect(await client.call(api.requests.get, { params: { id: ids[1]! } })).toMatchObject({ id: ids[1] });
    await expect(t.client(other.token).call(api.requests.get, { params: { id: ids[1]! } })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    expect((await t.client(other.token).call(api.requests.list)).items).toEqual([]);
  });

  it('idempotent create: the same Idempotency-Key replays the same request', async () => {
    const c = await createCustomer(t, { balance: 2000 });
    const body = await requestBody(t, { timing: 'EMERGENCY' });
    const a = await t.client(c.token).call(api.requests.create, { body, idempotencyKey: 'create-1' });
    const b = await t.client(c.token).call(api.requests.create, { body, idempotencyKey: 'create-1' });
    expect(b.id).toBe(a.id);
    expect(await t.prisma.serviceRequest.count()).toBe(1);
    expect(await t.prisma.hold.count()).toBe(1);
  });

  describe('account deletion / blocking race (users row locked FOR SHARE inside the create transaction)', () => {
    it('blocked user -> USER_BLOCKED, deleted user -> FORBIDDEN, nothing created', async () => {
      const c = await createCustomer(t, { balance: 2000 });
      const svc = t.app.get(RequestsService);
      const body = { ...(await requestBody(t)), photoFileIds: [], slots: 1, providerPreference: 'ANY' as const };
      await t.prisma.user.update({ where: { id: c.userId }, data: { status: 'BLOCKED' } });
      await expect(svc.create(c.userId, body, 'az')).rejects.toMatchObject({ code: 'USER_BLOCKED' });
      await t.prisma.user.update({ where: { id: c.userId }, data: { status: 'DELETED' } });
      await expect(svc.create(c.userId, body, 'az')).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(await t.prisma.serviceRequest.count()).toBe(0);
    });

    it('concurrent deleteAccount and create: never a request for a deleted user', async () => {
      for (let i = 0; i < 4; i++) {
        const c = await createCustomer(t);
        const svc = t.app.get(RequestsService);
        const me = t.app.get(MeService);
        const body = { ...(await requestBody(t)), photoFileIds: [], slots: 1, providerPreference: 'ANY' as const };
        const [created, deleted] = await Promise.allSettled([svc.create(c.userId, body, 'az'), me.deleteAccount(c.userId)]);
        const user = await t.prisma.user.findUniqueOrThrow({ where: { id: c.userId } });
        const requests = await t.prisma.serviceRequest.count({ where: { createdByUserId: c.userId } });
        if (user.status === 'DELETED') {
          expect(deleted.status).toBe('fulfilled');
          expect(created.status).toBe('rejected');
          expect(requests).toBe(0);
        } else {
          expect(created.status).toBe('fulfilled');
          expect(deleted.status).toBe('rejected');
          expect((deleted as PromiseRejectedResult).reason).toMatchObject({ code: 'INVALID_STATE' });
          expect(requests).toBe(1);
        }
      }
    });
  });

  describe('classify-photo', () => {
    it('classifies an own REQUEST_PHOTO with AiService and records the final category after creation', async () => {
      const c = await createCustomer(t);
      const photo = await upload(t, c.token, 'REQUEST_PHOTO');
      ai.returns({ category: 'plumbing', confidence: 'high', candidates: ['plumbing', 'heating'] });
      const res = await t.client(c.token).call(api.requests.classifyPhoto, { body: { fileId: photo.id, note: 'kran axır' } });
      expect(res).toMatchObject({ status: 'ok', slug: 'plumbing', confidence: 'high' });
      expect(res.categoryId).toBe(await categoryId(t, 'plumbing'));
      expect(ai.calls).toHaveLength(1);
      const log = await t.prisma.aiClassification.findFirstOrThrow({ where: { fileId: photo.id } });
      expect(log.finalCategoryId).toBeNull();
      await createRequest(t, c, { slug: 'heating', photoFileIds: [photo.id] });
      const after = await t.prisma.aiClassification.findFirstOrThrow({ where: { fileId: photo.id } });
      expect(after.finalCategoryId).toBe(await categoryId(t, 'heating'));
    });

    it("another user's photo or a non-REQUEST_PHOTO file -> FILE_NOT_OWNED, Claude never called", async () => {
      const c = await createCustomer(t);
      const other = await createCustomer(t);
      const theirs = await upload(t, other.token, 'REQUEST_PHOTO');
      const profile = await upload(t, c.token, 'PROFILE_PHOTO');
      await expect(t.client(c.token).call(api.requests.classifyPhoto, { body: { fileId: theirs.id } })).rejects.toMatchObject({ code: 'FILE_NOT_OWNED' });
      await expect(t.client(c.token).call(api.requests.classifyPhoto, { body: { fileId: profile.id } })).rejects.toMatchObject({ code: 'FILE_NOT_OWNED' });
      expect(ai.calls).toHaveLength(0);
    });

    it('is rate limited to 20 per hour per user', async () => {
      const c = await createCustomer(t);
      const photo = await upload(t, c.token, 'REQUEST_PHOTO');
      ai.throws(new Error('boom'));
      const limiter = t.app.get(RateLimiter);
      for (let i = 0; i < 20; i++) await limiter.hit(`classify:${c.userId}`, 20, 3600);
      await expect(t.client(c.token).call(api.requests.classifyPhoto, { body: { fileId: photo.id } })).rejects.toMatchObject({
        code: 'RATE_LIMITED',
        status: 429,
      });
      expect(ai.calls).toHaveLength(0);
    });
  });
});
