import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { S3StorageDriver } from '../../src/modules/files/storage/s3.driver';
import { createStorageDriver } from '../../src/modules/files/files.module';
import { loadEnv } from '../../src/config/env';

interface SeenRequest {
  method: string;
  path: string;
  contentType: string | undefined;
  authorization: string | undefined;
}

/** A tiny S3-compatible server (path-style only) that records every request. */
function fakeS3() {
  const objects = new Map<string, { body: Buffer; contentType: string }>();
  const seen: SeenRequest[] = [];
  let failNext: number | null = null;
  const readBody = (req: IncomingMessage) =>
    new Promise<Buffer>((resolve) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks)));
    });
  const server: Server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url!, 'http://x').pathname);
    seen.push({ method: req.method!, path, contentType: req.headers['content-type'], authorization: req.headers.authorization });
    const body = await readBody(req);
    if (failNext) {
      const status = failNext;
      failNext = null;
      res.writeHead(status, { 'content-type': 'application/xml' });
      res.end('<?xml version="1.0" encoding="UTF-8"?><Error><Code>AccessDenied</Code><Message>denied</Message></Error>');
      return;
    }
    if (req.method === 'PUT') {
      objects.set(path, { body, contentType: req.headers['content-type'] ?? 'application/octet-stream' });
      res.writeHead(200, { etag: '"abc"' });
      res.end();
      return;
    }
    if (req.method === 'GET') {
      const o = objects.get(path);
      if (!o) {
        res.writeHead(404, { 'content-type': 'application/xml' });
        res.end('<?xml version="1.0" encoding="UTF-8"?><Error><Code>NoSuchKey</Code><Message>missing</Message></Error>');
        return;
      }
      res.writeHead(200, { 'content-type': o.contentType, 'content-length': String(o.body.length) });
      res.end(o.body);
      return;
    }
    if (req.method === 'DELETE') {
      objects.delete(path);
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(405);
    res.end();
  });
  return {
    server,
    objects,
    seen,
    failWith(status: number) {
      failNext = status;
    },
  };
}

describe('A1 files: S3 storage driver (path-style, against a local S3-compatible server)', () => {
  const s3 = fakeS3();
  let endpoint: string;
  let driver: S3StorageDriver;

  beforeAll(async () => {
    await new Promise<void>((resolve) => s3.server.listen(0, '127.0.0.1', resolve));
    endpoint = `http://127.0.0.1:${(s3.server.address() as AddressInfo).port}`;
    driver = new S3StorageDriver({ endpoint, region: 'auto', bucket: 'tezfiks-files', accessKeyId: 'AKIDTEST', secretAccessKey: 'secret' });
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => s3.server.close(() => resolve()));
  });
  beforeEach(() => {
    s3.objects.clear();
    s3.seen.length = 0;
  });

  it('puts, gets and deletes objects with path-style URLs and signed requests', async () => {
    const body = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02]);
    await driver.put('REQUEST_PHOTO/2026/10/abc.jpg', body, 'image/jpeg');
    expect(s3.seen[0]).toMatchObject({ method: 'PUT', path: '/tezfiks-files/REQUEST_PHOTO/2026/10/abc.jpg', contentType: 'image/jpeg' });
    expect(s3.seen[0]!.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDTEST\//);
    expect(s3.objects.get('/tezfiks-files/REQUEST_PHOTO/2026/10/abc.jpg')?.body.equals(body)).toBe(true);

    const got = await driver.get('REQUEST_PHOTO/2026/10/abc.jpg');
    expect(got).toBeInstanceOf(Buffer);
    expect(got!.equals(body)).toBe(true);

    await driver.delete('REQUEST_PHOTO/2026/10/abc.jpg');
    expect(s3.seen.at(-1)).toMatchObject({ method: 'DELETE', path: '/tezfiks-files/REQUEST_PHOTO/2026/10/abc.jpg' });
    expect(s3.objects.size).toBe(0);
  });

  it('returns null for a missing object (NoSuchKey / 404)', async () => {
    await expect(driver.get('nope/missing.jpg')).resolves.toBeNull();
  });

  it('rethrows other storage errors', async () => {
    s3.failWith(403);
    await expect(driver.get('x.jpg')).rejects.toBeTruthy();
    s3.failWith(403);
    await expect(driver.put('x.jpg', Buffer.from('a'), 'image/jpeg')).rejects.toBeTruthy();
  });

  it('createStorageDriver picks s3 from the environment and requires a bucket', () => {
    const base = loadEnv();
    const s3Env = loadEnv({ ...process.env, STORAGE_DRIVER: 's3', S3_BUCKET: 'b', S3_ENDPOINT: endpoint });
    expect(createStorageDriver(s3Env)).toBeInstanceOf(S3StorageDriver);
    expect(() => createStorageDriver({ ...s3Env, S3_BUCKET: undefined } as typeof base)).toThrow(/S3_BUCKET/);
    expect(createStorageDriver(base)).not.toBeInstanceOf(S3StorageDriver);
  });
});
