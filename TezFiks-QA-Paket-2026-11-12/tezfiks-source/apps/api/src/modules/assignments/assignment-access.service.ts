import { Injectable } from '@nestjs/common';
import type { AssignmentStatus } from '@tezfiks/shared';
import { PrismaService, type Db, type Tx } from '../../infra/prisma.service';
import { RealtimeService } from '../../infra/realtime.service';
import { ApiException } from '../../common/http/api-exception';
import { RequestViews, type ProViewerMode } from '../requests/views/request-views.service';
import { RequestStateService, lockRequestRow } from '../requests/request-state.service';
import type { Assignment } from '../../generated/prisma/client';
import { isUuid } from './assignments.constants';

/** Parties of one assignment. */
export interface AssignmentParties {
  customerUserId: string;
  /** The request creator (same as the owner for app-created requests). */
  creatorUserId: string;
  /** The doer (solo handyman or company worker). */
  providerUserId: string;
  /** Active managers of the provider company (empty for solo jobs). */
  managerUserIds: string[];
  requestNumber: number;
}

/**
 * Who may see or act on an assignment, plus the shared after-commit announcements. Customer = the request's account owner
 * (or its creator); provider side = the doer and active managers of its company (spec 6.3). Foreign ids answer NOT_FOUND.
 */
@Injectable()
export class AssignmentAccess {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly views: RequestViews,
    private readonly state: RequestStateService,
  ) {}

  private notFound(id: string): never {
    throw new ApiException('NOT_FOUND', { entity: 'assignment', id });
  }

  async load(assignmentId: string, db: Db = this.prisma): Promise<Assignment> {
    if (!isUuid(assignmentId)) this.notFound(assignmentId);
    const a = await db.assignment.findUnique({ where: { id: assignmentId } });
    if (!a) this.notFound(assignmentId);
    return a;
  }

  async parties(a: Pick<Assignment, 'requestId' | 'handymanId' | 'companyId'>, db: Db = this.prisma): Promise<AssignmentParties> {
    const [r, h, managers] = await Promise.all([
      db.serviceRequest.findUniqueOrThrow({
        where: { id: a.requestId },
        select: { number: true, createdByUserId: true, customerAccount: { select: { ownerUserId: true } } },
      }),
      db.handymanProfile.findUniqueOrThrow({ where: { id: a.handymanId }, select: { userId: true } }),
      a.companyId
        ? db.companyMember.findMany({
            where: { companyId: a.companyId, role: 'MANAGER', status: 'ACTIVE' },
            select: { userId: true },
            orderBy: { userId: 'asc' },
          })
        : Promise.resolve([] as Array<{ userId: string }>),
    ]);
    return {
      customerUserId: r.customerAccount.ownerUserId,
      creatorUserId: r.createdByUserId,
      providerUserId: h.userId,
      managerUserIds: managers.map((m) => m.userId),
      requestNumber: r.number,
    };
  }

  /** The customer's assignment (NOT_FOUND for anyone else). */
  async forCustomer(userId: string, assignmentId: string, db: Db = this.prisma): Promise<Assignment> {
    const a = await this.load(assignmentId, db);
    const r = await db.serviceRequest.findUnique({
      where: { id: a.requestId },
      select: { createdByUserId: true, customerAccount: { select: { ownerUserId: true } } },
    });
    if (!r || (r.customerAccount.ownerUserId !== userId && r.createdByUserId !== userId)) this.notFound(assignmentId);
    return a;
  }

  /** Provider side: SOLO / WORKER (the doer) or MANAGER (active manager of its company). */
  async forProvider(userId: string, assignmentId: string, db: Db = this.prisma): Promise<{ a: Assignment; mode: ProViewerMode }> {
    const a = await this.load(assignmentId, db);
    const mode = await this.views.proViewerMode(a, userId, db);
    if (!mode) this.notFound(assignmentId);
    return { a, mode };
  }

  /** Company manager endpoints: the company must exist, the caller must manage it and the assignment must be the company's. */
  async forCompany(userId: string, companyId: string, assignmentId: string, db: Db = this.prisma): Promise<Assignment> {
    await this.requireManager(userId, companyId, db);
    const a = await this.load(assignmentId, db);
    if (a.companyId !== companyId) this.notFound(assignmentId);
    return a;
  }

  async requireManager(userId: string, companyId: string, db: Db = this.prisma): Promise<void> {
    const company = isUuid(companyId) ? await db.company.findUnique({ where: { id: companyId }, select: { id: true } }) : null;
    if (!company) throw new ApiException('NOT_FOUND', { entity: 'company', id: companyId });
    const m = await db.companyMember.findFirst({
      where: { companyId, userId, role: 'MANAGER', status: 'ACTIVE' },
      select: { id: true },
    });
    if (!m) throw new ApiException('NOT_COMPANY_MANAGER');
  }

  /**
   * Inside a transaction, after lockActiveUser: locks the request row, then the assignment row (B1 lock order) and returns the
   * fresh assignment.
   */
  async lockAssignment(tx: Tx, assignmentId: string): Promise<Assignment> {
    const ref = await tx.assignment.findUnique({ where: { id: assignmentId }, select: { requestId: true } });
    if (!ref) this.notFound(assignmentId);
    await lockRequestRow(tx, ref.requestId);
    await tx.$queryRawUnsafe('SELECT id FROM assignments WHERE id = $1::uuid FOR UPDATE', assignmentId);
    return tx.assignment.findUniqueOrThrow({ where: { id: assignmentId } });
  }

  /** assignment:updated to the assignment room, both parties' user rooms and the company room; then request:updated. */
  async announce(a: Pick<Assignment, 'id' | 'requestId' | 'status' | 'handymanId' | 'companyId'>, extraUserIds: string[] = []): Promise<void> {
    const p = await this.parties(a);
    const payload = { assignmentId: a.id, requestId: a.requestId, status: a.status as AssignmentStatus };
    this.realtime.toAssignment(a.id, 'assignment:updated', payload);
    for (const u of new Set([p.customerUserId, p.providerUserId, ...extraUserIds])) this.realtime.toUser(u, 'assignment:updated', payload);
    if (a.companyId) this.realtime.toCompany(a.companyId, 'assignment:updated', payload);
    await this.state.announce(a.requestId);
  }
}
