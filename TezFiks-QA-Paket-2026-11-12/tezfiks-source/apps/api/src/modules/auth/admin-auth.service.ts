import { Injectable } from '@nestjs/common';
import type { AdminMe, AdminRole } from '@tezfiks/shared';
import { PrismaService } from '../../infra/prisma.service';
import { Clock } from '../../infra/clock';
import { RateLimiter } from '../../infra/rate-limiter';
import { ApiException } from '../../common/http/api-exception';
import { SessionsService } from '../../common/auth/sessions.service';
import { AuditService } from '../../common/audit/audit.service';
import { hashPassword, verifyPassword } from '../../common/auth/password';
import type { IssuedTokens } from '../../common/auth/types';

export const ADMIN_LOGIN_LIMIT = 10;
export const ADMIN_LOGIN_WINDOW_SEC = 15 * 60;

/** TezFiks admin e-mail + password login. */
@Injectable()
export class AdminAuthService {
  private dummyHash?: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly rateLimiter: RateLimiter,
    private readonly sessions: SessionsService,
    private readonly audit: AuditService,
  ) {}

  /** Same work for unknown e-mails, so response time does not reveal which admin accounts exist. */
  private dummy(): Promise<string> {
    this.dummyHash ??= hashPassword('tezfiks-dummy-password');
    return this.dummyHash;
  }

  async login(
    input: { email: string; password: string },
    meta: { ip: string | null; userAgent: string | null },
  ): Promise<{ tokens: IssuedTokens; admin: AdminMe }> {
    const email = input.email.trim().toLowerCase();
    await this.rateLimiter.enforce(`admin-login:${meta.ip ?? 'unknown'}:${email}`, ADMIN_LOGIN_LIMIT, ADMIN_LOGIN_WINDOW_SEC);
    const admin = await this.prisma.adminUser.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
    const ok = await verifyPassword(input.password, admin?.passwordHash ?? (await this.dummy()));
    if (!admin || !ok || !admin.active) throw new ApiException('INVALID_CREDENTIALS');

    const now = this.clock.now();
    await this.prisma.adminUser.update({ where: { id: admin.id }, data: { lastLoginAt: now } });
    await this.audit.log({
      actorType: 'ADMIN',
      actorId: admin.id,
      action: 'admin.login',
      entityType: 'AdminUser',
      entityId: admin.id,
      after: { lastLoginAt: now.toISOString() },
      ip: meta.ip,
    });
    const tokens = await this.sessions.createAdminSession(admin.id, admin.role as AdminRole, { ip: meta.ip, userAgent: meta.userAgent });
    return { tokens, admin: { id: admin.id, email: admin.email, name: admin.name, role: admin.role as AdminRole } };
  }
}
