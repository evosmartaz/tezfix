import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleInit } from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import sharp from 'sharp';
import { isKycFileKind, type FileKind, type FileRef } from '@tezfiks/shared';
import { ENV, type Env } from '../../config/env';
import { PrismaService } from '../../infra/prisma.service';
import { Clock } from '../../infra/clock';
import { JobsService } from '../../infra/jobs.service';
import { ReconcilerService } from '../../infra/reconciler.service';
import { RateLimiter } from '../../infra/rate-limiter';
import { newId } from '../../infra/ids';
import { ApiException } from '../../common/http/api-exception';
import type { File } from '../../generated/prisma/client';
import { STORAGE_DRIVER, type StorageDriver } from './storage/storage.driver';

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const ALLOWED_UPLOAD_TYPES = ['image/jpeg', 'image/jpg', 'image/pjpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
/** sharp metadata formats accepted after decoding (the declared type alone is not trusted). */
const ALLOWED_DECODED_FORMATS = ['jpeg', 'png', 'webp', 'heif'];
export const UPLOADS_PER_HOUR = 60;
export const FILES_PURGE_JOB = 'files.purge';
/** Daily purge (BullMQ job scheduler, Asia/Baku): 04:15 every day. The reconciler task with the same name is the safety net. */
export const FILES_PURGE_CRON = '15 4 * * *';
/**
 * Non-KYC signed URLs expire on bucket boundaries (rounded DOWN, never beyond FILE_URL_TTL_SEC) so the same image keeps
 * the same URL for a while (client caching). Bucket = min(300 s, TTL / 2), so a URL is always valid for at least TTL / 2.
 */
const EXP_BUCKET_SEC = 300;
/** KYC (admin-only) URLs: exact TTL, at most 10 minutes (spec §12 "Signed URLs (HMAC, 10 minutes)"), no caching. */
export const KYC_URL_MAX_TTL_SEC = 600;
/** HEVC-coded HEIC images are decoded in WebAssembly (prebuilt sharp has no HEVC decoder); refuse absurd pixel counts first. */
export const MAX_HEIC_PIXELS = 40_000_000;

export interface UploadInput {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

export interface DownloadResult {
  buffer: Buffer;
  contentType: string;
  cacheControl: string;
}

/**
 * Files: uploads (re-encoded with sharp, EXIF stripped), signed download URLs, KYC access control and purge.
 * Other lanes use ref/refs/refOf to render FileRef values and assertOwned to validate file ids sent by users.
 */
@Injectable()
export class FilesService implements OnModuleInit, OnApplicationBootstrap {
  private readonly log = new Logger('Files');

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
    private readonly clock: Clock,
    private readonly jobs: JobsService,
    private readonly reconciler: ReconcilerService,
    private readonly rateLimiter: RateLimiter,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit(): void {
    this.jobs.register(FILES_PURGE_JOB, async () => {
      await this.purgeDue();
    });
    // Safety net: deletes objects whose purgeAfter has passed (indexed, cheap), also after downtime.
    this.reconciler.register(FILES_PURGE_JOB, async () => {
      await this.purgeDue();
    });
  }

  /**
   * Registers the daily purge cron. Global modules (InfraModule, which owns JobsService and creates the BullMQ queue in its
   * own onApplicationBootstrap) are bootstrapped before feature modules by Nest (distance = MAX_VALUE), so the queue exists here.
   * No-op in JOBS_MODE=manual (tests drive the purge with runNow / the reconciler).
   */
  async onApplicationBootstrap(): Promise<void> {
    await this.jobs.repeat(FILES_PURGE_JOB, FILES_PURGE_CRON, { reason: 'daily' });
  }

  // ---------------------------------------------------------------- signing

  private mac(value: string): string {
    return createHmac('sha256', this.env.fileUrlSecret).update(value).digest('base64url');
  }

  private static safeEqual(a: string, b: string): boolean {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && timingSafeEqual(x, y);
  }

  private signature(fileId: string, exp: number, adminId?: string): string {
    return adminId ? `${adminId}.${this.mac(`file:${fileId}:${exp}:${adminId}`)}` : this.mac(`file:${fileId}:${exp}`);
  }

  private expiry(kyc: boolean): number {
    const nowSec = Math.floor(this.clock.nowMs() / 1000);
    const ttl = this.env.FILE_URL_TTL_SEC;
    if (kyc) return nowSec + Math.min(ttl, KYC_URL_MAX_TTL_SEC);
    const bucket = Math.max(1, Math.min(EXP_BUCKET_SEC, Math.floor(ttl / 2)));
    return Math.floor((nowSec + ttl) / bucket) * bucket;
  }

  /** Signed URL for a file row. KYC files get a usable signature only when `adminId` is given. */
  signedUrl(file: Pick<File, 'id' | 'kind'>, opts: { adminId?: string } = {}): string {
    const kyc = isKycFileKind(file.kind as FileKind);
    const exp = this.expiry(kyc);
    const adminId = kyc ? opts.adminId : undefined;
    const sig = this.signature(file.id, exp, adminId);
    return `${this.env.publicApiUrl}/files/${file.id}?exp=${exp}&sig=${encodeURIComponent(sig)}`;
  }

  /** Synchronous FileRef for a loaded row. */
  refOf(file: File, opts: { adminId?: string } = {}): FileRef {
    return {
      id: file.id,
      kind: file.kind as FileKind,
      url: this.signedUrl(file, opts),
      contentType: file.contentType,
      width: file.width ?? null,
      height: file.height ?? null,
    };
  }

  /** FileRef for a row or id (NOT_FOUND when the id does not exist or the file was purged). */
  async ref(file: File | string, opts: { adminId?: string } = {}): Promise<FileRef> {
    const row = typeof file === 'string' ? await this.prisma.file.findUnique({ where: { id: file } }) : file;
    if (!row || row.deletedAt) throw new ApiException('NOT_FOUND', { fileId: typeof file === 'string' ? file : file.id });
    return this.refOf(row, opts);
  }

  /** FileRefs in the order of `ids`; missing or purged files are skipped. */
  async refs(ids: string[], opts: { adminId?: string } = {}): Promise<FileRef[]> {
    if (!ids.length) return [];
    const rows = await this.prisma.file.findMany({ where: { id: { in: [...new Set(ids)] }, deletedAt: null } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const out: FileRef[] = [];
    for (const id of ids) {
      const row = byId.get(id);
      if (row) out.push(this.refOf(row, opts));
    }
    return out;
  }

  /** Throws FILE_NOT_OWNED unless every file exists, belongs to `userId`, is not purged and (optionally) has one of `kinds`. */
  async assertOwned(userId: string, fileIds: string[], kinds?: readonly FileKind[]): Promise<void> {
    const ids = [...new Set(fileIds)];
    if (!ids.length) return;
    const rows = await this.prisma.file.findMany({ where: { id: { in: ids } } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const bad = ids.filter((id) => {
      const row = byId.get(id);
      return !row || row.ownerUserId !== userId || row.deletedAt != null || (kinds && !kinds.includes(row.kind as FileKind));
    });
    if (bad.length) throw new ApiException('FILE_NOT_OWNED', { fileIds: bad });
  }

  /** Raw bytes of a stored file (server-side use, e.g. AI classification). */
  async read(fileId: string): Promise<{ buffer: Buffer; contentType: string }> {
    const row = await this.prisma.file.findUnique({ where: { id: fileId } });
    if (!row || row.deletedAt) throw new ApiException('NOT_FOUND', { fileId });
    const buffer = await this.storage.get(row.storageKey);
    if (!buffer) throw new ApiException('NOT_FOUND', { fileId });
    return { buffer, contentType: row.contentType };
  }

  /** Schedules files for deletion (the purge removes the stored objects once `at` has passed). */
  async markPurge(fileIds: string[], at: Date): Promise<void> {
    if (!fileIds.length) return;
    await this.prisma.file.updateMany({ where: { id: { in: fileIds }, deletedAt: null }, data: { purgeAfter: at } });
  }

  /** Deletes stored objects of files past purgeAfter and marks the rows deleted. Returns the number purged. */
  async purgeDue(limit = 500): Promise<number> {
    const now = this.clock.now();
    const due = await this.prisma.file.findMany({
      where: { purgeAfter: { lte: now }, deletedAt: null },
      orderBy: { purgeAfter: 'asc' },
      take: limit,
    });
    let purged = 0;
    for (const f of due) {
      try {
        await this.storage.delete(f.storageKey);
        const r = await this.prisma.file.updateMany({ where: { id: f.id, deletedAt: null }, data: { deletedAt: now } });
        if (r.count) {
          await this.prisma.user.updateMany({ where: { photoFileId: f.id }, data: { photoFileId: null } });
          purged += r.count;
        }
      } catch (err) {
        this.log.warn(`purge of file ${f.id} failed: ${(err as Error).message}`);
      }
    }
    return purged;
  }

  // ---------------------------------------------------------------- upload

  /** Validates, re-encodes (JPEG, max 2048 px, EXIF stripped) and stores an uploaded image. */
  async upload(userId: string, kind: FileKind, input: UploadInput): Promise<FileRef> {
    if (input.size > MAX_UPLOAD_BYTES || input.buffer.length > MAX_UPLOAD_BYTES) {
      throw new ApiException('FILE_TOO_LARGE', { maxBytes: MAX_UPLOAD_BYTES });
    }
    if (!ALLOWED_UPLOAD_TYPES.includes(input.mimetype.toLowerCase())) {
      throw new ApiException('FILE_TYPE_NOT_ALLOWED', { contentType: input.mimetype });
    }
    await this.rateLimiter.enforce(`files:upload:${userId}`, UPLOADS_PER_HOUR, 3600);

    let meta: sharp.Metadata | undefined;
    try {
      meta = await sharp(input.buffer).metadata();
    } catch {
      meta = undefined;
    }
    if (!meta?.format || !ALLOWED_DECODED_FORMATS.includes(meta.format)) {
      throw new ApiException('FILE_TYPE_NOT_ALLOWED', { contentType: input.mimetype });
    }
    const source = FilesService.isHevcHeif(meta) ? await this.decodeHevcHeif(input, meta) : sharp(input.buffer);
    let out: { data: Buffer; info: sharp.OutputInfo };
    try {
      out = await source
        .rotate()
        .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toBuffer({ resolveWithObject: true });
    } catch {
      throw new ApiException('FILE_TYPE_NOT_ALLOWED', { contentType: input.mimetype });
    }

    const id = newId();
    const now = this.clock.now();
    const yyyy = String(now.getUTCFullYear());
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const storageKey = `${kind}/${yyyy}/${mm}/${id}.jpg`;
    await this.storage.put(storageKey, out.data, 'image/jpeg');
    try {
      const row = await this.prisma.file.create({
        data: {
          id,
          ownerUserId: userId,
          kind,
          storageKey,
          contentType: 'image/jpeg',
          size: out.data.length,
          sha256: createHash('sha256').update(out.data).digest('hex'),
          width: out.info.width,
          height: out.info.height,
          createdAt: now,
        },
      });
      return this.refOf(row);
    } catch (err) {
      await this.storage.delete(storageKey).catch(() => undefined);
      throw err;
    }
  }

  /** iPhone HEIC: HEIF container with HEVC coding. sharp reads its metadata but the prebuilt libvips cannot decode HEVC. */
  private static isHevcHeif(meta: sharp.Metadata): boolean {
    return meta.format === 'heif' && meta.compression === 'hevc';
  }

  /** Decodes an HEVC HEIC (primary image, transforms applied) with libheif compiled to WebAssembly and hands sharp the raw RGBA. */
  private async decodeHevcHeif(input: UploadInput, meta: sharp.Metadata): Promise<sharp.Sharp> {
    if ((meta.width ?? 0) * (meta.height ?? 0) > MAX_HEIC_PIXELS) {
      throw new ApiException('FILE_TOO_LARGE', { maxPixels: MAX_HEIC_PIXELS });
    }
    try {
      const { default: decodeHeic } = await import('heic-decode');
      const img = await decodeHeic({ buffer: input.buffer });
      if (!img.width || !img.height || img.width * img.height > MAX_HEIC_PIXELS) throw new Error('bad dimensions');
      const raw = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength);
      return sharp(raw, { raw: { width: img.width, height: img.height, channels: 4 } });
    } catch (err) {
      if (err instanceof ApiException) throw err;
      this.log.warn(`HEIC decode failed: ${(err as Error).message}`);
      throw new ApiException('FILE_TYPE_NOT_ALLOWED', { contentType: input.mimetype });
    }
  }

  // -------------------------------------------------------------- download

  /**
   * Verifies a signed URL and returns the bytes. Bad/expired signatures -> FORBIDDEN. KYC files require an admin
   * signature of an active admin, and every KYC download is written to KycAccessLog.
   */
  async download(fileId: string, exp: string, sig: string): Promise<DownloadResult> {
    if (!/^\d{1,12}$/.test(exp)) throw new ApiException('FORBIDDEN', { reason: 'BAD_SIGNATURE' });
    const expSec = Number(exp);
    let adminId: string | undefined;
    let valid: boolean;
    const dot = sig.indexOf('.');
    if (dot >= 0) {
      adminId = sig.slice(0, dot);
      valid = FilesService.safeEqual(sig, this.signature(fileId, expSec, adminId));
    } else {
      valid = FilesService.safeEqual(sig, this.signature(fileId, expSec));
    }
    if (!valid) throw new ApiException('FORBIDDEN', { reason: 'BAD_SIGNATURE' });
    if (expSec < Math.floor(this.clock.nowMs() / 1000)) throw new ApiException('FORBIDDEN', { reason: 'EXPIRED' });

    const row = await this.prisma.file.findUnique({ where: { id: fileId } });
    if (!row || row.deletedAt) throw new ApiException('NOT_FOUND');
    const kyc = isKycFileKind(row.kind as FileKind);
    if (kyc) {
      if (!adminId) throw new ApiException('FORBIDDEN', { reason: 'ADMIN_ONLY' });
      const admin = await this.prisma.adminUser.findUnique({ where: { id: adminId }, select: { active: true } });
      if (!admin?.active) throw new ApiException('FORBIDDEN', { reason: 'ADMIN_ONLY' });
    }
    const buffer = await this.storage.get(row.storageKey);
    if (!buffer) throw new ApiException('NOT_FOUND');
    if (kyc) await this.prisma.kycAccessLog.create({ data: { adminId: adminId!, fileId: row.id, at: this.clock.now() } });
    return { buffer, contentType: row.contentType, cacheControl: kyc ? 'private, no-store' : 'private, max-age=300' };
  }
}
