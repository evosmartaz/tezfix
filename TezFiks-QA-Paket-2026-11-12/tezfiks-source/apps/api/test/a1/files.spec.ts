import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api } from '@tezfiks/shared';
import { createTestApp, type TestApp } from '../helpers/app';
import { adminToken, createUser, tokenFor } from '../helpers/factories';
import { FilesService, FILES_PURGE_JOB } from '../../src/modules/files/files.service';
import { STORAGE_DRIVER, type StorageDriver } from '../../src/modules/files/storage/storage.driver';
import { localUrl, pngBuffer, upload } from './helpers';

describe('A1 files: upload, signed download, KYC, purge', () => {
  let t: TestApp;
  let files: FilesService;
  let storage: StorageDriver;
  beforeAll(async () => {
    t = await createTestApp();
    files = t.app.get(FilesService);
    storage = t.app.get(STORAGE_DRIVER);
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
  });

  async function user() {
    const u = await createUser(t);
    return { ...u, token: await tokenFor(t, u.userId) };
  }

  describe('upload', () => {
    it('re-encodes a PNG to JPEG within 2048 px and stores sha256, size and dimensions', async () => {
      const u = await user();
      const ref = await upload(t, u.token, 'REQUEST_PHOTO', { buffer: await pngBuffer(3000, 1000) });
      expect(ref).toMatchObject({ kind: 'REQUEST_PHOTO', contentType: 'image/jpeg', width: 2048, height: 683 });
      const row = await t.prisma.file.findUniqueOrThrow({ where: { id: ref.id } });
      expect(row.ownerUserId).toBe(u.userId);
      const now = t.clock.now();
      expect(row.storageKey).toBe(
        `REQUEST_PHOTO/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${ref.id}.jpg`,
      );
      const stored = await storage.get(row.storageKey);
      expect(stored).not.toBeNull();
      expect(row.sha256).toBe(createHash('sha256').update(stored!).digest('hex'));
      expect(row.size).toBe(stored!.length);
      const meta = await sharp(stored!).metadata();
      expect(meta).toMatchObject({ format: 'jpeg', width: 2048, height: 683 });
    });

    it('does not enlarge small images and strips EXIF metadata', async () => {
      const u = await user();
      const jpegWithExif = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#0B1B2B' } })
        .jpeg()
        .withExif({ IFD0: { Copyright: 'secret-gps-owner', Make: 'TestPhone' } })
        .toBuffer();
      expect((await sharp(jpegWithExif).metadata()).exif).toBeDefined();
      const ref = await upload(t, u.token, 'PROFILE_PHOTO', { buffer: jpegWithExif, type: 'image/jpeg', name: 'me.jpg' });
      expect(ref).toMatchObject({ width: 40, height: 30 });
      const res = await fetch(localUrl(t, ref.url));
      expect(res.status).toBe(200);
      const bytes = Buffer.from(await res.arrayBuffer());
      const meta = await sharp(bytes).metadata();
      expect(meta.exif).toBeUndefined();
      expect(bytes.toString('latin1')).not.toContain('secret-gps-owner');
    });

    it('accepts WebP', async () => {
      const u = await user();
      const webp = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#F59E0B' } }).webp().toBuffer();
      await expect(upload(t, u.token, 'CASE_PHOTO', { buffer: webp, type: 'image/webp', name: 'x.webp' })).resolves.toMatchObject({
        contentType: 'image/jpeg',
      });
    });

    it('rejects disallowed types (declared or actual) with FILE_TYPE_NOT_ALLOWED', async () => {
      const u = await user();
      await expect(
        upload(t, u.token, 'REQUEST_PHOTO', { buffer: Buffer.from('hello world'), type: 'text/plain', name: 'a.txt' }),
      ).rejects.toMatchObject({ code: 'FILE_TYPE_NOT_ALLOWED', status: 415 });
      const gif = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000' } }).gif().toBuffer();
      await expect(upload(t, u.token, 'REQUEST_PHOTO', { buffer: gif, type: 'image/gif', name: 'a.gif' })).rejects.toMatchObject({
        code: 'FILE_TYPE_NOT_ALLOWED',
      });
      // a GIF (or garbage) disguised as PNG is detected after decoding
      await expect(upload(t, u.token, 'REQUEST_PHOTO', { buffer: gif, type: 'image/png' })).rejects.toMatchObject({
        code: 'FILE_TYPE_NOT_ALLOWED',
      });
      await expect(upload(t, u.token, 'REQUEST_PHOTO', { buffer: Buffer.from('not an image at all'), type: 'image/jpeg' })).rejects.toMatchObject({
        code: 'FILE_TYPE_NOT_ALLOWED',
      });
      expect(await t.prisma.file.count()).toBe(0);
    });

    it('rejects files over 8 MB with FILE_TOO_LARGE', async () => {
      const u = await user();
      const big = Buffer.alloc(8 * 1024 * 1024 + 10, 1);
      await expect(upload(t, u.token, 'REQUEST_PHOTO', { buffer: big, type: 'image/jpeg' })).rejects.toMatchObject({
        code: 'FILE_TOO_LARGE',
        status: 413,
      });
      expect(await t.prisma.file.count()).toBe(0);
    });

    it('validates the kind field, requires a file and requires auth', async () => {
      const u = await user();
      const fd = new FormData();
      fd.append('kind', 'SELFIE_OF_CAT');
      fd.append('file', new Blob([new Uint8Array(await pngBuffer())], { type: 'image/png' }), 'a.png');
      await expect(t.client(u.token).call(api.files.upload, { formData: fd })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
      const noFile = new FormData();
      noFile.append('kind', 'REQUEST_PHOTO');
      await expect(t.client(u.token).call(api.files.upload, { formData: noFile })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      await expect(upload(t, '', 'REQUEST_PHOTO')).rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401 });
    });

    it('limits uploads to 60 per user per hour', async () => {
      const u = await user();
      const buf = await pngBuffer(8, 8);
      for (let i = 0; i < 60; i++) await upload(t, u.token, 'REQUEST_PHOTO', { buffer: buf });
      await expect(upload(t, u.token, 'REQUEST_PHOTO', { buffer: buf })).rejects.toMatchObject({ code: 'RATE_LIMITED', status: 429 });
      const other = await user();
      await expect(upload(t, other.token, 'REQUEST_PHOTO', { buffer: buf })).resolves.toBeTruthy();
    }, 120_000);
  });

  describe('signed download', () => {
    it('serves the file with nosniff and private caching for a valid signature', async () => {
      const u = await user();
      const ref = await upload(t, u.token, 'REQUEST_PHOTO');
      const url = new URL(ref.url);
      expect(`${url.origin}${url.pathname}`).toBe(`http://127.0.0.1:3000/tezfix/api/files/${ref.id}`);
      const res = await fetch(localUrl(t, ref.url));
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/jpeg');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('cache-control')).toBe('private, max-age=300');
      const bytes = Buffer.from(await res.arrayBuffer());
      expect((await sharp(bytes).metadata()).format).toBe('jpeg');
      // anyone holding the signed URL can view it (no auth header needed); the FileRef from refs() is equivalent
      const [again] = await files.refs([ref.id]);
      expect((await fetch(localUrl(t, again!.url))).status).toBe(200);
    });

    it('refuses tampered signatures, another file id and expired URLs with FORBIDDEN', async () => {
      const u = await user();
      const ref = await upload(t, u.token, 'REQUEST_PHOTO');
      const other = await upload(t, u.token, 'REQUEST_PHOTO');
      const url = new URL(localUrl(t, ref.url));
      const sig = url.searchParams.get('sig')!;
      const exp = url.searchParams.get('exp')!;

      const tampered = new URL(url);
      tampered.searchParams.set('sig', (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1));
      const r1 = await fetch(tampered);
      expect(r1.status).toBe(403);
      expect(((await r1.json()) as { error: { code: string } }).error.code).toBe('FORBIDDEN');

      const longer = new URL(url);
      longer.searchParams.set('exp', String(Number(exp) + 86_400));
      expect((await fetch(longer)).status).toBe(403);

      const swapped = new URL(url.toString().replace(ref.id, other.id));
      expect((await fetch(swapped)).status).toBe(403);

      t.clock.advance(2 * 3600_000);
      const expired = await fetch(url);
      expect(expired.status).toBe(403);
      expect(((await expired.json()) as { error: { details: { reason: string } } }).error.details.reason).toBe('EXPIRED');
    });

    it('returns NOT_FOUND for a purged file and a missing id', async () => {
      const u = await user();
      const ref = await upload(t, u.token, 'REQUEST_PHOTO');
      await files.markPurge([ref.id], t.clock.now());
      await t.jobs.runNow(FILES_PURGE_JOB, {});
      expect((await fetch(localUrl(t, ref.url))).status).toBe(404);
      await expect(files.ref(ref.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('KYC files', () => {
    it('are only downloadable through an admin signature, and every view is logged', async () => {
      const u = await user();
      const ref = await upload(t, u.token, 'KYC_ID_FRONT');
      // the owner's own FileRef is not usable
      const own = await fetch(localUrl(t, ref.url));
      expect(own.status).toBe(403);
      expect(await t.prisma.kycAccessLog.count()).toBe(0);

      const admin = await adminToken(t);
      const adminRef = await files.ref(ref.id, { adminId: admin.adminId });
      expect(new URL(adminRef.url).searchParams.get('sig')!.startsWith(`${admin.adminId}.`)).toBe(true);
      const res = await fetch(localUrl(t, adminRef.url));
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('private, no-store');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      await fetch(localUrl(t, adminRef.url));
      const logs = await t.prisma.kycAccessLog.findMany({ where: { fileId: ref.id } });
      expect(logs).toHaveLength(2);
      expect(logs[0]!.adminId).toBe(admin.adminId);

      // the admin id inside the signature cannot be swapped
      const other = await adminToken(t);
      const u2 = new URL(localUrl(t, adminRef.url));
      const mac = u2.searchParams.get('sig')!.split('.')[1]!;
      u2.searchParams.set('sig', `${other.adminId}.${mac}`);
      expect((await fetch(u2)).status).toBe(403);

      // a deactivated admin's URLs stop working
      await t.prisma.adminUser.update({ where: { id: admin.adminId }, data: { active: false } });
      expect((await fetch(localUrl(t, adminRef.url))).status).toBe(403);
      expect(await t.prisma.kycAccessLog.count()).toBe(2);
    });

    it('all KYC kinds and COMPANY_DOC are admin-only; non-KYC files work with admin signatures too', async () => {
      const u = await user();
      const admin = await adminToken(t);
      for (const kind of ['KYC_ID_BACK', 'KYC_SELFIE', 'KYC_SELFIE_TURN', 'KYC_SELFIE_BLINK', 'KYC_TRADE_PROOF', 'COMPANY_DOC'] as const) {
        const ref = await upload(t, u.token, kind, { buffer: await pngBuffer(8, 8) });
        expect((await fetch(localUrl(t, ref.url))).status).toBe(403);
      }
      const photo = await upload(t, u.token, 'REQUEST_PHOTO');
      const adminRef = await files.ref(photo.id, { adminId: admin.adminId });
      expect((await fetch(localUrl(t, adminRef.url))).status).toBe(200);
      expect(await t.prisma.kycAccessLog.count()).toBe(0);
    });
  });

  describe('FilesService', () => {
    it('refs keeps order and skips missing ids; assertOwned checks owner and kind', async () => {
      const u = await user();
      const a = await upload(t, u.token, 'REQUEST_PHOTO');
      const b = await upload(t, u.token, 'PROFILE_PHOTO');
      const refs = await files.refs([b.id, '0199f0f0-0000-7000-8000-00000000dead', a.id]);
      expect(refs.map((r) => r.id)).toEqual([b.id, a.id]);
      await expect(files.assertOwned(u.userId, [a.id, b.id])).resolves.toBeUndefined();
      await expect(files.assertOwned(u.userId, [a.id, b.id], ['REQUEST_PHOTO'])).rejects.toMatchObject({
        code: 'FILE_NOT_OWNED',
        details: { fileIds: [b.id] },
      });
      const other = await user();
      await expect(files.assertOwned(other.userId, [a.id])).rejects.toMatchObject({ code: 'FILE_NOT_OWNED' });
      await expect(files.assertOwned(other.userId, [])).resolves.toBeUndefined();
      const read = await files.read(a.id);
      expect(read.contentType).toBe('image/jpeg');
      expect((await sharp(read.buffer).metadata()).format).toBe('jpeg');
    });

    it('purge deletes stored objects past purgeAfter only (job and reconciler)', async () => {
      const u = await user();
      const now1 = await upload(t, u.token, 'REQUEST_PHOTO');
      const later = await upload(t, u.token, 'KYC_SELFIE');
      const keep = await upload(t, u.token, 'REQUEST_PHOTO');
      await files.markPurge([now1.id], t.clock.now());
      await files.markPurge([later.id], new Date(t.clock.nowMs() + 30 * 86_400_000));
      await t.jobs.runNow(FILES_PURGE_JOB, {});
      const rows = await t.prisma.file.findMany();
      const byId = new Map(rows.map((r) => [r.id, r]));
      expect(byId.get(now1.id)!.deletedAt).not.toBeNull();
      expect(await storage.get(byId.get(now1.id)!.storageKey)).toBeNull();
      expect(byId.get(later.id)!.deletedAt).toBeNull();
      expect(byId.get(keep.id)!.deletedAt).toBeNull();

      t.clock.advance(30 * 86_400_000 + 1000);
      await t.reconciler.tickAll();
      const laterRow = await t.prisma.file.findUniqueOrThrow({ where: { id: later.id } });
      expect(laterRow.deletedAt).not.toBeNull();
      expect(await storage.get(laterRow.storageKey)).toBeNull();
      expect((await t.prisma.file.findUniqueOrThrow({ where: { id: keep.id } })).deletedAt).toBeNull();
    });
  });
});
