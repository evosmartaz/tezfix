import { Inject, Injectable } from '@nestjs/common';
import type { AppKind, AdminRole } from '@tezfiks/shared';
import { ENV, type Env } from '../../config/env';
import { PrismaService } from '../../infra/prisma.service';
import { Clock } from '../../infra/clock';
import { ApiException } from '../http/api-exception';
import { TokenService } from './token.service';
import type { IssuedTokens, Principal } from './types';

export interface SessionMeta {
  deviceId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

const CACHE_MS = 10_000;
/** A just-rotated refresh token may be presented again this long after its rotation (lost response on mobile data). */
export const REFRESH_GRACE_MS = 60_000;

/** Sessions with rotating refresh tokens; reuse of a rotated refresh token revokes the session. */
@Injectable()
export class SessionsService {
  private readonly cache = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private refreshExpiry(): Date {
    return new Date(this.clock.nowMs() + this.env.JWT_REFRESH_TTL_DAYS * 86_400_000);
  }

  private issue(p: Principal, refreshToken: string, refreshExpiresAt: Date): IssuedTokens {
    const access = this.tokens.signAccess(p);
    return {
      accessToken: access.token,
      refreshToken,
      accessExpiresAt: access.expiresAt.toISOString(),
      refreshExpiresAt: refreshExpiresAt.toISOString(),
    };
  }

  async createUserSession(userId: string, app: AppKind, meta: SessionMeta = {}): Promise<IssuedTokens> {
    const refreshToken = this.tokens.newRefreshToken();
    const expiresAt = this.refreshExpiry();
    const session = await this.prisma.session.create({
      data: {
        userId,
        app,
        deviceId: meta.deviceId ?? null,
        refreshTokenHash: this.tokens.hash(refreshToken),
        expiresAt,
        ip: meta.ip ?? null,
        userAgent: meta.userAgent?.slice(0, 300) ?? null,
        lastUsedAt: this.clock.now(),
      },
    });
    return this.issue({ kind: 'user', userId, sessionId: session.id, app }, refreshToken, expiresAt);
  }

  async createAdminSession(adminId: string, role: AdminRole, meta: SessionMeta = {}): Promise<IssuedTokens> {
    const refreshToken = this.tokens.newRefreshToken();
    const expiresAt = this.refreshExpiry();
    const session = await this.prisma.session.create({
      data: {
        adminId,
        app: 'ADMIN',
        refreshTokenHash: this.tokens.hash(refreshToken),
        expiresAt,
        ip: meta.ip ?? null,
        userAgent: meta.userAgent?.slice(0, 300) ?? null,
        lastUsedAt: this.clock.now(),
      },
    });
    return this.issue({ kind: 'admin', adminId, sessionId: session.id, role }, refreshToken, expiresAt);
  }

  /**
   * Rotates a refresh token with one conditional write (only while the presented token is still the current one), so two
   * concurrent refreshes with the same token rotate it once: the loser gets a retryable CONFLICT and nothing is revoked.
   *
   * Reuse of an already-rotated token revokes the whole session, except inside REFRESH_GRACE_MS after that rotation: a mobile
   * client whose refresh response was lost retries with the previous token, which then rotates again (the token of the lost
   * response dies). `lastUsedAt` is the time of the last rotation away from `previousTokenHash`; a grace rotation keeps it,
   * so the window never slides.
   */
  async rotate(refreshToken: string, meta: SessionMeta = {}): Promise<IssuedTokens> {
    const hash = this.tokens.hash(refreshToken);
    const now = this.clock.now();
    const include = { user: true, admin: true } as const;
    const current = await this.prisma.session.findUnique({ where: { refreshTokenHash: hash }, include });
    const session = current ?? (await this.prisma.session.findFirst({ where: { previousTokenHash: hash, revokedAt: null }, include }));
    if (!session) throw new ApiException('REFRESH_INVALID');
    if (session.revokedAt) throw new ApiException('SESSION_REVOKED');
    const grace = !current;
    if (grace && now.getTime() - session.lastUsedAt.getTime() > REFRESH_GRACE_MS) {
      await this.revoke(session.id, 'REFRESH_REUSE');
      throw new ApiException('SESSION_REVOKED');
    }
    if (session.expiresAt <= now) throw new ApiException('REFRESH_INVALID');
    if (session.user && session.user.status !== 'ACTIVE') {
      throw new ApiException(session.user.status === 'BLOCKED' ? 'USER_BLOCKED' : 'UNAUTHORIZED');
    }
    if (session.admin && !session.admin.active) throw new ApiException('UNAUTHORIZED');
    const next = this.tokens.newRefreshToken();
    const expiresAt = this.refreshExpiry();
    const rotated = await this.prisma.session.updateMany({
      where: grace
        ? { id: session.id, revokedAt: null, previousTokenHash: hash, refreshTokenHash: session.refreshTokenHash }
        : { id: session.id, revokedAt: null, refreshTokenHash: hash },
      data: {
        refreshTokenHash: this.tokens.hash(next),
        previousTokenHash: hash,
        expiresAt,
        ...(grace ? {} : { lastUsedAt: now }),
        ip: meta.ip ?? session.ip,
        deviceId: meta.deviceId ?? session.deviceId,
      },
    });
    // Another request rotated the same token a moment ago (a concurrent duplicate): refuse without revoking, the client
    // keeps the tokens of the request that won.
    if (rotated.count === 0) throw new ApiException('CONFLICT', { reason: 'REFRESH_IN_PROGRESS' });
    const p: Principal = session.adminId
      ? { kind: 'admin', adminId: session.adminId, sessionId: session.id, role: session.admin!.role }
      : { kind: 'user', userId: session.userId!, sessionId: session.id, app: session.app };
    return this.issue(p, next, expiresAt);
  }

  async revoke(sessionId: string, reason: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: this.clock.now(), revokeReason: reason },
    });
    this.cache.delete(sessionId);
  }

  async revokeAllForUser(userId: string, reason: string): Promise<void> {
    const sessions = await this.prisma.session.findMany({ where: { userId, revokedAt: null }, select: { id: true } });
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: this.clock.now(), revokeReason: reason },
    });
    for (const s of sessions) this.cache.delete(s.id);
  }

  /** Throws when the session is revoked or the user is blocked/deleted (cached for 10 s). */
  async validate(p: Principal): Promise<void> {
    const until = this.cache.get(p.sessionId);
    if (until && until > Date.now()) return;
    const session = await this.prisma.session.findUnique({
      where: { id: p.sessionId },
      include: { user: { select: { status: true } }, admin: { select: { active: true } } },
    });
    if (!session || session.revokedAt) throw new ApiException('SESSION_REVOKED');
    if (p.kind === 'user') {
      if (session.userId !== p.userId || !session.user) throw new ApiException('UNAUTHORIZED');
      if (session.user.status === 'BLOCKED') throw new ApiException('USER_BLOCKED');
      if (session.user.status !== 'ACTIVE') throw new ApiException('UNAUTHORIZED');
    } else {
      if (session.adminId !== p.adminId || !session.admin?.active) throw new ApiException('UNAUTHORIZED');
    }
    this.cache.set(p.sessionId, Date.now() + CACHE_MS);
  }

  /** Drops cached validations (call after blocking a user). */
  invalidateCache(): void {
    this.cache.clear();
  }
}
