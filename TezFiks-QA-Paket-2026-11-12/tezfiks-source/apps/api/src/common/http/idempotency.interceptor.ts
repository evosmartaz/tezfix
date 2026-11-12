import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import { from, lastValueFrom, type Observable } from 'rxjs';
import type { Response } from 'express';
import type { Endpoint } from '@tezfiks/shared';
import { ENDPOINT_META } from './route.decorator';
import { ApiException } from './api-exception';
import { PrismaService } from '../../infra/prisma.service';
import { Clock } from '../../infra/clock';
import type { Principal } from '../auth/types';

const LOCK_MS = 60_000;

/**
 * Stripe-style idempotency for endpoints marked `idempotent` in the contract:
 * the first request with an Idempotency-Key runs, later requests with the same key and the same input get the
 * stored response; a different input under the same key fails with IDEMPOTENCY_CONFLICT. Failed requests release the key.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const endpoint = this.reflector.get<Endpoint | undefined>(ENDPOINT_META, ctx.getHandler());
    if (!endpoint?.idempotent) return next.handle();
    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string | undefined>; input?: unknown; auth?: Principal }>();
    const clientKey = req.headers['idempotency-key'];
    if (!clientKey) return next.handle();
    if (clientKey.length > 200) throw new ApiException('VALIDATION_FAILED', { header: 'Idempotency-Key too long' });
    const subject = req.auth ? (req.auth.kind === 'user' ? req.auth.userId : req.auth.adminId) : 'anon';
    const key = `${subject}:${endpoint.method}:${endpoint.path}:${clientKey}`;
    const requestHash = createHash('sha256').update(JSON.stringify(req.input ?? null)).digest('hex');
    const res = ctx.switchToHttp().getResponse<Response>();
    return from(this.run(key, requestHash, res, () => lastValueFrom(next.handle())));
  }

  private async run(key: string, requestHash: string, res: Response, handler: () => Promise<unknown>): Promise<unknown> {
    const now = this.clock.now();
    const lockedUntil = new Date(now.getTime() + LOCK_MS);
    const created = await this.prisma.idempotencyKey
      .create({ data: { key, requestHash, lockedUntil } })
      .then(() => true)
      .catch((err: { code?: string }) => {
        if (err?.code === 'P2002') return false;
        throw err;
      });
    if (!created) {
      const row = await this.prisma.idempotencyKey.findUnique({ where: { key } });
      if (row) {
        if (row.requestHash !== requestHash) throw new ApiException('IDEMPOTENCY_CONFLICT');
        if (row.responseStatus != null) {
          res.status(row.responseStatus);
          res.setHeader('Idempotent-Replayed', 'true');
          return row.responseBody;
        }
        if (row.lockedUntil && row.lockedUntil > now) throw new ApiException('CONFLICT', { reason: 'REQUEST_IN_PROGRESS' });
        await this.prisma.idempotencyKey.update({ where: { key }, data: { lockedUntil } });
      } else {
        await this.prisma.idempotencyKey.create({ data: { key, requestHash, lockedUntil } });
      }
    }
    try {
      const out = await handler();
      await this.prisma.idempotencyKey.update({
        where: { key },
        data: { responseStatus: 200, responseBody: (out ?? null) as never, lockedUntil: null },
      });
      return out;
    } catch (err) {
      await this.prisma.idempotencyKey.delete({ where: { key } }).catch(() => undefined);
      throw err;
    }
  }
}
