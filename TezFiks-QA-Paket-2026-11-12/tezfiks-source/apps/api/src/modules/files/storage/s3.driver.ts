import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { StorageDriver } from './storage.driver';

export interface S3DriverOptions {
  endpoint?: string;
  region?: string;
  bucket: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

/** S3-compatible object storage (Supabase Storage, Cloudflare R2, MinIO). Path-style addressing. */
export class S3StorageDriver implements StorageDriver {
  readonly name = 's3';
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(opts: S3DriverOptions, client?: S3Client) {
    this.bucket = opts.bucket;
    this.client =
      client ??
      new S3Client({
        endpoint: opts.endpoint,
        region: opts.region ?? 'auto',
        forcePathStyle: true,
        credentials:
          opts.accessKeyId && opts.secretAccessKey ? { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey } : undefined,
      });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!out.Body) return null;
      const bytes = await out.Body.transformToByteArray();
      return Buffer.from(bytes);
    } catch (err) {
      const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
