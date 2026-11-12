import { Injectable } from '@nestjs/common';
import { PrismaService, type Db } from '../../infra/prisma.service';

export interface AuditInput {
  actorType: 'ADMIN' | 'USER' | 'SYSTEM';
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

function json(v: unknown): unknown {
  if (v === undefined) return undefined;
  return JSON.parse(JSON.stringify(v, (_k, val) => (typeof val === 'bigint' ? Number(val) : val)));
}

/** Append-only audit trail; every admin mutation must write one row. */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(input: AuditInput, db: Db = this.prisma): Promise<void> {
    await db.auditLog.create({
      data: {
        actorType: input.actorType,
        actorId: input.actorId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        before: json(input.before) as never,
        after: json(input.after) as never,
        ip: input.ip ?? null,
      },
    });
  }
}
