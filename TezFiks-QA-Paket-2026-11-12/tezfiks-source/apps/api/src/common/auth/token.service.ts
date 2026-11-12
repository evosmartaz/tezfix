import { Inject, Injectable } from '@nestjs/common';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { ENV, type Env } from '../../config/env';
import { RedisService } from '../../infra/redis.service';
import { Clock } from '../../infra/clock';
import { ApiException } from '../http/api-exception';
import type { AccessClaims, Principal } from './types';

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(ENV) private readonly env: Env,
    private readonly redis: RedisService,
    private readonly clock: Clock,
  ) {}

  signAccess(p: Principal): { token: string; expiresAt: Date } {
    const nowSec = Math.floor(this.clock.nowMs() / 1000);
    const exp = nowSec + this.env.JWT_ACCESS_TTL_SEC;
    const claims: AccessClaims & { iat: number; exp: number } =
      p.kind === 'user'
        ? { sub: p.userId, typ: 'user', sid: p.sessionId, app: p.app, iat: nowSec, exp }
        : { sub: p.adminId, typ: 'admin', sid: p.sessionId, role: p.role, iat: nowSec, exp };
    const token = this.jwt.sign(claims, { secret: this.env.JWT_SECRET, algorithm: 'HS256' });
    return { token, expiresAt: new Date(exp * 1000) };
  }

  verifyAccess(token: string): Principal {
    let claims: AccessClaims & { exp: number };
    try {
      claims = this.jwt.verify(token, {
        secret: this.env.JWT_SECRET,
        algorithms: ['HS256'],
        clockTimestamp: Math.floor(this.clock.nowMs() / 1000),
      });
    } catch {
      throw new ApiException('UNAUTHORIZED');
    }
    if (claims.typ === 'user' && claims.app) {
      return { kind: 'user', userId: claims.sub, sessionId: claims.sid, app: claims.app };
    }
    if (claims.typ === 'admin' && claims.role) {
      return { kind: 'admin', adminId: claims.sub, sessionId: claims.sid, role: claims.role };
    }
    throw new ApiException('UNAUTHORIZED');
  }

  newRefreshToken(): string {
    return randomBytes(48).toString('base64url');
  }

  hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** 60-second single-use ticket for the Socket.IO handshake (web panels). */
  async issueRealtimeTicket(p: Principal): Promise<{ ticket: string; expiresAt: Date }> {
    const ticket = randomBytes(24).toString('base64url');
    await this.redis.client.set(this.redis.key('rt', ticket), JSON.stringify(p), 'EX', 60);
    return { ticket, expiresAt: new Date(this.clock.nowMs() + 60_000) };
  }

  async consumeRealtimeTicket(ticket: string): Promise<Principal | null> {
    const raw = await this.redis.client.getdel(this.redis.key('rt', ticket));
    return raw ? (JSON.parse(raw) as Principal) : null;
  }

  /** HMAC signature helper (file URLs, checkout links). */
  sign(value: string, secret = this.env.fileUrlSecret): string {
    return createHmac('sha256', secret).update(value).digest('base64url');
  }

  verifySignature(value: string, signature: string, secret = this.env.fileUrlSecret): boolean {
    const expected = Buffer.from(this.sign(value, secret));
    const actual = Buffer.from(signature);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
}
