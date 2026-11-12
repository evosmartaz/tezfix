import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ArgumentsHost } from '@nestjs/common';
import { createTestApp, type TestApp } from './helpers/app';
import { createUser } from './helpers/factories';
import { ErrorFilter } from '../src/common/http/error.filter';
import { I18nService } from '../src/common/i18n/i18n.service';
import { ENV, type Env } from '../src/config/env';
import { inTx } from '../src/infra/prisma.service';

/** Renders an exception through the real filter and returns what the client would receive. */
function render(filter: ErrorFilter, exception: unknown) {
  const out: { status?: number; body?: { error: { code: string; message: string; details?: Record<string, unknown> } } } = {};
  const res = {
    headersSent: false,
    status(code: number) {
      out.status = code;
      return res;
    },
    json(body: never) {
      out.body = body;
      return res;
    },
  };
  const req = { method: 'POST', url: '/tezfix/api/x', headers: { 'accept-language': 'az' } };
  const host = {
    getType: () => 'http',
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }),
  } as unknown as ArgumentsHost;
  filter.catch(exception, host);
  return out;
}

describe('error filter: database write conflicts', () => {
  let t: TestApp;
  let filter: ErrorFilter;
  beforeAll(async () => {
    t = await createTestApp();
    filter = new ErrorFilter(t.app.get(I18nService), t.app.get<Env>(ENV));
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
  });

  it('answers a real Postgres deadlock with a retryable 409 CONFLICT instead of a 500', async () => {
    const a = await createUser(t);
    const b = await createUser(t);
    let release!: () => void;
    const bothLocked = new Promise<void>((r) => (release = r));
    let locked = 0;
    const lockThenCross = (first: string, second: string) =>
      inTx(t.prisma, async (tx) => {
        await tx.$queryRawUnsafe('SELECT id FROM users WHERE id = $1::uuid FOR UPDATE', first);
        if (++locked === 2) release();
        await bothLocked;
        await tx.$queryRawUnsafe('SELECT id FROM users WHERE id = $1::uuid FOR UPDATE', second);
      });
    const results = await Promise.allSettled([lockThenCross(a.userId, b.userId), lockThenCross(b.userId, a.userId)]);
    const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(failures).toHaveLength(1);

    const out = render(filter, failures[0]!.reason);
    expect(out.status).toBe(409);
    expect(out.body?.error.code).toBe('CONFLICT');
    expect(out.body?.error.details).toMatchObject({ reason: 'WRITE_CONFLICT', retryable: true });
    expect(out.body?.error.message).toBeTruthy();
  });

  it('still maps unique violations to CONFLICT and unknown errors to INTERNAL', async () => {
    const u = await createUser(t);
    const dup = await t.prisma.user
      .create({ data: { phone: (await t.prisma.user.findUniqueOrThrow({ where: { id: u.userId } })).phone } })
      .catch((e: unknown) => e);
    expect(render(filter, dup)).toMatchObject({ status: 409, body: { error: { code: 'CONFLICT' } } });
    expect(render(filter, new Error('boom'))).toMatchObject({ status: 500, body: { error: { code: 'INTERNAL' } } });
  });
});
