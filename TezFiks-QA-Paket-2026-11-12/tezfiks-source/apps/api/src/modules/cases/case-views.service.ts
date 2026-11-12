import { Injectable } from '@nestjs/common';
import type { AdminAssignmentRow, CaseView } from '@tezfiks/shared';
import { PrismaService } from '../../infra/prisma.service';
import { iso, num, numOrNull } from '../../common/mapping';
import { FilesService } from '../files/files.service';
import { fullName } from '../assignments/assignments.constants';
import type { Case } from '../../generated/prisma/client';

export interface AdminCaseRowView {
  id: string;
  type: Case['type'];
  status: Case['status'];
  requestNumber: number | null;
  projectNumber: number | null;
  customerName: string;
  providerName: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Contract views of cases (customer CaseView, admin rows and the admin assignment row). */
@Injectable()
export class CaseViews {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
  ) {}

  private async context(rows: Case[]) {
    const assignmentIds = [...new Set(rows.map((c) => c.assignmentId).filter((v): v is string => !!v))];
    const projectIds = [...new Set(rows.map((c) => c.projectId).filter((v): v is string => !!v))];
    const [assignments, projects] = await Promise.all([
      assignmentIds.length
        ? this.prisma.assignment.findMany({
            where: { id: { in: assignmentIds } },
            select: {
              id: true,
              providerType: true,
              request: { select: { number: true, customerAccount: { select: { owner: { select: { firstName: true, lastName: true } } } } } },
              handyman: { select: { user: { select: { firstName: true, lastName: true } } } },
              company: { select: { name: true } },
            },
          })
        : [],
      projectIds.length
        ? this.prisma.project.findMany({
            where: { id: { in: projectIds } },
            select: {
              id: true,
              number: true,
              awardedQuoteId: true,
              customerAccount: { select: { owner: { select: { firstName: true, lastName: true } } } },
            },
          })
        : [],
    ]);
    const quoteIds = projects.map((p) => p.awardedQuoteId).filter((v): v is string => !!v);
    const quotes = quoteIds.length
      ? await this.prisma.quote.findMany({
          where: { id: { in: quoteIds } },
          select: { id: true, company: { select: { name: true } }, handyman: { select: { user: { select: { firstName: true, lastName: true } } } } },
        })
      : [];
    return {
      assignments: new Map(assignments.map((a) => [a.id, a])),
      projects: new Map(projects.map((p) => [p.id, p])),
      quotes: new Map(quotes.map((q) => [q.id, q])),
    };
  }

  async toViews(rows: Case[]): Promise<CaseView[]> {
    if (!rows.length) return [];
    const ctx = await this.context(rows);
    const out: CaseView[] = [];
    for (const c of rows) {
      const a = c.assignmentId ? ctx.assignments.get(c.assignmentId) : undefined;
      const p = c.projectId ? ctx.projects.get(c.projectId) : undefined;
      out.push({
        id: c.id,
        type: c.type,
        status: c.status,
        assignmentId: c.assignmentId ?? null,
        projectId: c.projectId ?? null,
        requestNumber: a?.request.number ?? null,
        projectNumber: p?.number ?? null,
        description: c.description,
        photos: await this.files.refs(c.photoFileIds),
        resolutionNote: c.resolutionNote ?? null,
        followUpRequestId: c.followUpRequestId ?? null,
        createdAt: iso(c.createdAt),
        updatedAt: iso(c.updatedAt),
      });
    }
    return out;
  }

  async toView(c: Case): Promise<CaseView> {
    return (await this.toViews([c]))[0]!;
  }

  async toRows(rows: Case[]): Promise<AdminCaseRowView[]> {
    if (!rows.length) return [];
    const ctx = await this.context(rows);
    return rows.map((c) => {
      const a = c.assignmentId ? ctx.assignments.get(c.assignmentId) : undefined;
      const p = c.projectId ? ctx.projects.get(c.projectId) : undefined;
      const q = p?.awardedQuoteId ? ctx.quotes.get(p.awardedQuoteId) : undefined;
      const owner = a?.request.customerAccount.owner ?? p?.customerAccount.owner;
      let providerName: string | null = null;
      if (a) providerName = a.providerType === 'COMPANY' && a.company ? a.company.name : fullName(a.handyman.user.firstName, a.handyman.user.lastName);
      else if (q) providerName = q.company?.name ?? (q.handyman ? fullName(q.handyman.user.firstName, q.handyman.user.lastName) : null);
      return {
        id: c.id,
        type: c.type,
        status: c.status,
        requestNumber: a?.request.number ?? null,
        projectNumber: p?.number ?? null,
        customerName: owner ? fullName(owner.firstName, owner.lastName) : '',
        providerName,
        createdAt: iso(c.createdAt),
        updatedAt: iso(c.updatedAt),
      };
    });
  }

  /** Admin view of the case's assignment (admins see both phones). */
  async assignmentRow(assignmentId: string | null): Promise<AdminAssignmentRow | null> {
    if (!assignmentId) return null;
    const a = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: {
        request: { select: { number: true, customerAccount: { select: { owner: { select: { firstName: true, lastName: true, phone: true } } } } } },
        handyman: { select: { user: { select: { firstName: true, lastName: true, phone: true } } } },
        company: { select: { name: true } },
      },
    });
    if (!a) return null;
    const owner = a.request.customerAccount.owner;
    const provider = a.handyman.user;
    return {
      id: a.id,
      requestId: a.requestId,
      requestNumber: a.request.number,
      status: a.status,
      providerType: a.providerType,
      providerName: fullName(provider.firstName, provider.lastName),
      providerPhone: provider.phone,
      companyName: a.company?.name ?? null,
      customerName: fullName(owner.firstName, owner.lastName),
      customerPhone: owner.phone,
      acceptedAt: iso(a.acceptedAt),
      completedAt: iso(a.completedAt),
      cancelledAt: iso(a.cancelledAt),
      cancelledBy: a.cancelledBy ?? null,
      price: a.totalAmount != null ? { labor: num(a.laborAmount), materials: num(a.materialsAmount), total: num(a.totalAmount) } : null,
      paymentMethod: a.paymentMethod ?? null,
      fee: a.feeHoldId || a.feeAmount > 0n ? { amount: num(a.feeAmount), captured: a.feeCaptured, refunded: a.feeRefunded } : null,
      contactUnlockedAt: iso(a.contactUnlockedAt),
      etaSec: numOrNull(a.etaSec),
    };
  }
}
