import { Injectable } from '@nestjs/common';
import type { EndpointOutput, EndpointQuery, api } from '@tezfiks/shared';
import { PrismaService } from '../../infra/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { DEFAULT_LIMIT, decodeTimeCursor, encodeTimeCursor, fullName } from './admin-common';

type AuditQuery = EndpointQuery<typeof api.admin.audit>;
type AuditPage = EndpointOutput<typeof api.admin.audit>;

/** Paged audit trail (newest first), filterable by entity; actor names resolved for admins and users. */
@Injectable()
export class AdminAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async list(q: AuditQuery): Promise<AuditPage> {
    const limit = q.limit ?? DEFAULT_LIMIT;
    const cur = decodeTimeCursor(q.cursor);
    const where: Prisma.AuditLogWhereInput = {
      ...(q.entityType ? { entityType: q.entityType } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
      ...(cur
        ? { OR: [{ at: { lt: new Date(cur.c) } }, { at: new Date(cur.c), id: { lt: cur.i } }] }
        : {}),
    };
    const rows = await this.prisma.auditLog.findMany({ where, orderBy: [{ at: 'desc' }, { id: 'desc' }], take: limit + 1 });
    const page = rows.slice(0, limit);
    const adminIds = [...new Set(page.filter((r) => r.actorType === 'ADMIN' && r.actorId).map((r) => r.actorId!))];
    const userIds = [...new Set(page.filter((r) => r.actorType === 'USER' && r.actorId).map((r) => r.actorId!))];
    const [admins, users] = await Promise.all([
      adminIds.length ? this.prisma.adminUser.findMany({ where: { id: { in: adminIds } }, select: { id: true, name: true, email: true } }) : [],
      userIds.length ? this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true, phone: true } }) : [],
    ]);
    const adminName = new Map(admins.map((a) => [a.id, a.name || a.email]));
    const userName = new Map(users.map((u) => [u.id, fullName(u.firstName, u.lastName) || u.phone]));
    const items = page.map((r) => ({
      id: r.id,
      actorType: r.actorType,
      actorId: r.actorId ?? null,
      actorName:
        r.actorType === 'ADMIN' && r.actorId
          ? (adminName.get(r.actorId) ?? null)
          : r.actorType === 'USER' && r.actorId
            ? (userName.get(r.actorId) ?? null)
            : null,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId ?? null,
      before: r.before ?? null,
      after: r.after ?? null,
      ip: r.ip ?? null,
      at: r.at.toISOString(),
    }));
    const last = rows.length > limit ? page[page.length - 1] : undefined;
    return { items, nextCursor: last ? encodeTimeCursor(last.at, last.id) : null };
  }
}
