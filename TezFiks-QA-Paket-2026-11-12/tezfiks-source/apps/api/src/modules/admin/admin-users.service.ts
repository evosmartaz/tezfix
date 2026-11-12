import { Injectable } from '@nestjs/common';
import type { AdminMe, AdminRole, EndpointBody, EndpointOutput, api } from '@tezfiks/shared';
import { PrismaService, inTx, type Db } from '../../infra/prisma.service';
import { Clock } from '../../infra/clock';
import { RealtimeService } from '../../infra/realtime.service';
import { ApiException } from '../../common/http/api-exception';
import { AuditService } from '../../common/audit/audit.service';
import { SessionsService } from '../../common/auth/sessions.service';
import { hashPassword } from '../../common/auth/password';
import { iso } from '../../common/mapping';
import type { AdminPrincipal } from '../../common/auth/types';
import type { AdminUser } from '../../generated/prisma/client';

type AdminUserView = EndpointOutput<typeof api.admin.createAdmin>;
type CreateAdminBody = EndpointBody<typeof api.admin.createAdmin>;
type UpdateAdminBody = EndpointBody<typeof api.admin.updateAdmin>;

export function adminUserView(a: AdminUser): AdminUserView {
  return {
    id: a.id,
    email: a.email,
    name: a.name,
    role: a.role as AdminRole,
    active: a.active,
    createdAt: a.createdAt.toISOString(),
    lastLoginAt: iso(a.lastLoginAt),
  };
}

/**
 * TezFiks admin users: /admin/me, the admins list and admin management.
 * Role rules: every admin (ADMIN or OPERATOR) can read; only an active ADMIN may create or change admins (and change
 * platform settings); OPERATOR gets FORBIDDEN. The role is always read from the database, never from the access token,
 * so a demotion takes effect at once.
 */
@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
    private readonly sessions: SessionsService,
  ) {}

  async me(adminId: string): Promise<AdminMe> {
    const a = await this.prisma.adminUser.findUnique({ where: { id: adminId } });
    if (!a || !a.active) throw new ApiException('UNAUTHORIZED');
    return { id: a.id, email: a.email, name: a.name, role: a.role as AdminRole };
  }

  /** The acting admin must be an active ADMIN (OPERATOR -> FORBIDDEN). */
  async requireAdminRole(adminId: string, db: Db = this.prisma): Promise<AdminUser> {
    const a = await db.adminUser.findUnique({ where: { id: adminId } });
    if (!a || !a.active) throw new ApiException('UNAUTHORIZED');
    if (a.role !== 'ADMIN') throw new ApiException('FORBIDDEN', { reason: 'ADMIN_ROLE_REQUIRED', role: a.role });
    return a;
  }

  async list(): Promise<{ items: AdminUserView[] }> {
    const rows = await this.prisma.adminUser.findMany({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    return { items: rows.map(adminUserView) };
  }

  async create(actor: AdminPrincipal, body: CreateAdminBody, ip: string | null): Promise<AdminUserView> {
    const email = body.email.trim().toLowerCase();
    const passwordHash = await hashPassword(body.password);
    const created = await inTx(this.prisma, async (tx) => {
      await this.lockAdmins(tx);
      await this.requireAdminRole(actor.adminId, tx);
      const taken = await tx.adminUser.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true } });
      if (taken) throw new ApiException('CONFLICT', { reason: 'EMAIL_TAKEN', field: 'email' });
      const a = await tx.adminUser.create({
        data: { email, name: body.name.trim(), passwordHash, role: body.role, active: true, createdAt: this.clock.now() },
      });
      await this.audit.log(
        {
          actorType: 'ADMIN',
          actorId: actor.adminId,
          action: 'admin.create',
          entityType: 'AdminUser',
          entityId: a.id,
          before: null,
          after: { email: a.email, name: a.name, role: a.role, active: a.active },
          ip,
        },
        tx,
      );
      return a;
    });
    this.realtime.toAdmins('admin:event', { type: 'ADMIN_CREATED', entityId: created.id });
    return adminUserView(created);
  }

  async update(actor: AdminPrincipal, id: string, body: UpdateAdminBody, ip: string | null): Promise<AdminUserView> {
    const self = id === actor.adminId;
    if (self && body.active === false) throw new ApiException('FORBIDDEN', { reason: 'SELF_DEACTIVATE' });
    if (self && body.role !== undefined && body.role !== 'ADMIN') throw new ApiException('FORBIDDEN', { reason: 'SELF_DEMOTE' });
    const passwordHash = body.password !== undefined ? await hashPassword(body.password) : undefined;
    const out = await inTx(this.prisma, async (tx) => {
      // Serializes admin management so two admins demoting each other at once cannot leave no active ADMIN.
      await this.lockAdmins(tx);
      await this.requireAdminRole(actor.adminId, tx);
      const before = await tx.adminUser.findUnique({ where: { id } });
      if (!before) throw new ApiException('NOT_FOUND', { entity: 'AdminUser' });
      const data: { name?: string; role?: AdminRole; active?: boolean; passwordHash?: string } = {};
      if (body.name !== undefined) data.name = body.name.trim();
      if (body.role !== undefined) data.role = body.role;
      if (body.active !== undefined) data.active = body.active;
      if (passwordHash !== undefined) data.passwordHash = passwordHash;
      const after = Object.keys(data).length ? await tx.adminUser.update({ where: { id }, data }) : before;
      const activeAdmins = await tx.adminUser.count({ where: { role: 'ADMIN', active: true } });
      if (activeAdmins === 0) throw new ApiException('INVALID_STATE', { reason: 'LAST_ADMIN' });
      const sessionsChanged =
        before.role !== after.role || before.active !== after.active || passwordHash !== undefined;
      await this.audit.log(
        {
          actorType: 'ADMIN',
          actorId: actor.adminId,
          action: 'admin.update',
          entityType: 'AdminUser',
          entityId: id,
          before: { name: before.name, role: before.role, active: before.active },
          after: {
            name: after.name,
            role: after.role,
            active: after.active,
            ...(passwordHash !== undefined ? { passwordChanged: true } : {}),
          },
          ip,
        },
        tx,
      );
      if (sessionsChanged) {
        // Deactivation, a role change or a new password ends the admin's other sessions (the access token carries the role).
        await tx.session.updateMany({
          where: { adminId: id, revokedAt: null, ...(self ? { id: { not: actor.sessionId } } : {}) },
          data: { revokedAt: this.clock.now(), revokeReason: 'ADMIN_UPDATED' },
        });
      }
      return { after, sessionsChanged };
    });
    if (out.sessionsChanged) this.sessions.invalidateCache();
    this.realtime.toAdmins('admin:event', { type: 'ADMIN_UPDATED', entityId: id });
    return adminUserView(out.after);
  }

  private async lockAdmins(tx: Db): Promise<void> {
    await tx.$queryRawUnsafe(`SELECT id FROM admin_users WHERE role = 'ADMIN' AND active ORDER BY id FOR UPDATE`);
  }
}
