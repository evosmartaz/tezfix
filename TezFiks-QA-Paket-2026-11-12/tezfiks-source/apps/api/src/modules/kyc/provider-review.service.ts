import { Injectable, Logger } from '@nestjs/common';
import type { VerificationStatus } from '@tezfiks/shared';
import { PrismaService, inTx } from '../../infra/prisma.service';
import { Clock } from '../../infra/clock';
import { RealtimeService } from '../../infra/realtime.service';
import { DomainEvents, type DomainEventMap } from '../../infra/events';
import { ApiException } from '../../common/http/api-exception';
import { AuditService } from '../../common/audit/audit.service';
import { FilesService } from '../files/files.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ProviderLiveService } from '../pro/provider-live.service';
import { KYC_RETENTION_MS } from '../pro/provider-common';
import type { VerificationSubmission } from '../../generated/prisma/client';

export interface ExtractedKyc {
  docNumberLast4?: string;
  birthDate?: string;
  expiry?: string;
}

function dateOnly(d: string | undefined): Date | null {
  return d ? new Date(`${d}T00:00:00.000Z`) : null;
}

function submissionFileIds(s: VerificationSubmission): string[] {
  return [s.idFrontFileId, s.idBackFileId, s.selfieFrontFileId, s.selfieTurnFileId, s.selfieBlinkFileId, ...s.tradeProofFileIds, ...s.companyDocFileIds];
}

/**
 * Admin verification decisions for handymen and companies (approve / reject / block / unblock / clear strikes) and user
 * blocking. Every mutation is audited. Blocking takes effect on live sockets at once: DB offline flags are committed
 * first, then presence is cleared, the affected sessions are revoked and their sockets dropped.
 */
@Injectable()
export class ProviderReviewService {
  private readonly log = new Logger('ProviderReview');

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly realtime: RealtimeService,
    private readonly events: DomainEvents,
    private readonly audit: AuditService,
    private readonly files: FilesService,
    private readonly notifications: NotificationsService,
    private readonly live: ProviderLiveService,
  ) {}

  /** Domain events are informational here: a failing listener must not fail a committed admin decision. */
  private async emit<K extends keyof DomainEventMap>(event: K, payload: DomainEventMap[K]): Promise<void> {
    try {
      await this.events.emit(event, payload);
    } catch (err) {
      this.log.warn(`${String(event)} listener failed: ${(err as Error).message}`);
    }
  }

  private async purgeLater(sub: VerificationSubmission | null): Promise<void> {
    if (sub) await this.files.markPurge(submissionFileIds(sub), new Date(this.clock.nowMs() + KYC_RETENTION_MS));
  }

  private async handyman(id: string) {
    const p = await this.prisma.handymanProfile.findUnique({ where: { id } });
    if (!p) throw new ApiException('NOT_FOUND', { entity: 'HandymanProfile' });
    return p;
  }

  private async company(id: string) {
    const c = await this.prisma.company.findUnique({ where: { id } });
    if (!c) throw new ApiException('NOT_FOUND', { entity: 'Company' });
    return c;
  }

  private async activeMembers(companyId: string, role?: 'MANAGER' | 'WORKER'): Promise<string[]> {
    const rows = await this.prisma.companyMember.findMany({ where: { companyId, status: 'ACTIVE', ...(role ? { role } : {}) }, select: { userId: true } });
    return rows.map((r) => r.userId);
  }

  // --------------------------------------------------------------- handymen

  /** PENDING_REVIEW -> APPROVED; the pending submission records the reviewer and extracted fields; files purge in 30 days. */
  async approveHandyman(adminId: string, id: string, extracted: ExtractedKyc | undefined, ip: string | null): Promise<void> {
    const p = await this.handyman(id);
    const now = this.clock.now();
    const sub = await inTx(this.prisma, async (tx) => {
      const r = await tx.handymanProfile.updateMany({
        where: { id, status: 'PENDING_REVIEW' },
        data: { status: 'APPROVED', approvedAt: now, rejectReason: null },
      });
      if (!r.count) throw new ApiException('INVALID_STATE', { status: p.status });
      const pending = await tx.verificationSubmission.findFirst({ where: { handymanId: id, status: 'PENDING_REVIEW' }, orderBy: { createdAt: 'desc' } });
      const updated = pending
        ? await tx.verificationSubmission.update({
            where: { id: pending.id },
            data: {
              status: 'APPROVED',
              reviewedByAdminId: adminId,
              reviewedAt: now,
              docNumberLast4: extracted?.docNumberLast4 ?? null,
              birthDate: dateOnly(extracted?.birthDate),
              docExpiry: dateOnly(extracted?.expiry),
            },
          })
        : null;
      await this.audit.log(
        { actorType: 'ADMIN', actorId: adminId, action: 'handyman.approve', entityType: 'HandymanProfile', entityId: id, before: { status: p.status }, after: { status: 'APPROVED', submissionId: updated?.id ?? null }, ip },
        tx,
      );
      return updated;
    });
    await this.purgeLater(sub);
    await this.notifications.notify(p.userId, 'KYC_APPROVED', { app: 'PRO', data: { handymanId: id } });
    this.realtime.toUser(p.userId, 'profile:updated', { reason: 'KYC_APPROVED' });
    await this.emit('handyman.status', { handymanId: id, userId: p.userId, status: 'APPROVED' });
  }

  /** PENDING_REVIEW -> REJECTED with a reason (the provider may resubmit, max 3 per 24 h); files purge in 30 days. */
  async rejectHandyman(adminId: string, id: string, reason: string, ip: string | null): Promise<void> {
    const p = await this.handyman(id);
    const now = this.clock.now();
    const sub = await inTx(this.prisma, async (tx) => {
      const r = await tx.handymanProfile.updateMany({ where: { id, status: 'PENDING_REVIEW' }, data: { status: 'REJECTED', rejectReason: reason } });
      if (!r.count) throw new ApiException('INVALID_STATE', { status: p.status });
      const pending = await tx.verificationSubmission.findFirst({ where: { handymanId: id, status: 'PENDING_REVIEW' }, orderBy: { createdAt: 'desc' } });
      const updated = pending
        ? await tx.verificationSubmission.update({
            where: { id: pending.id },
            data: { status: 'REJECTED', reviewedByAdminId: adminId, reviewedAt: now, rejectReason: reason },
          })
        : null;
      await this.audit.log(
        { actorType: 'ADMIN', actorId: adminId, action: 'handyman.reject', entityType: 'HandymanProfile', entityId: id, before: { status: p.status }, after: { status: 'REJECTED', reason }, ip },
        tx,
      );
      return updated;
    });
    await this.purgeLater(sub);
    await this.notifications.notify(p.userId, 'KYC_REJECTED', { app: 'PRO', vars: { reason }, data: { handymanId: id, submissionId: sub?.id ?? null } });
    this.realtime.toUser(p.userId, 'profile:updated', { reason: 'KYC_REJECTED' });
    await this.emit('handyman.status', { handymanId: id, userId: p.userId, status: 'REJECTED' });
  }

  /** Any state -> BLOCKED (already BLOCKED -> INVALID_STATE): offline, PRO sessions revoked and their sockets dropped. */
  async blockHandyman(adminId: string, id: string, reason: string, ip: string | null): Promise<void> {
    const p = await this.handyman(id);
    await inTx(this.prisma, async (tx) => {
      const r = await tx.handymanProfile.updateMany({
        where: { id, status: { not: 'BLOCKED' } },
        data: { status: 'BLOCKED', blockedReason: reason, isOnline: false },
      });
      if (!r.count) throw new ApiException('INVALID_STATE', { status: 'BLOCKED' });
      await this.audit.log(
        { actorType: 'ADMIN', actorId: adminId, action: 'handyman.block', entityType: 'HandymanProfile', entityId: id, before: { status: p.status }, after: { status: 'BLOCKED', reason }, ip },
        tx,
      );
    });
    await this.live.forceOffline([id]);
    await this.notifications.notify(p.userId, 'ACCOUNT_BLOCKED', { app: 'PRO', vars: { reason }, data: { handymanId: id } });
    this.realtime.toUser(p.userId, 'profile:updated', { reason: 'BLOCKED' });
    await this.live.kickSessions([p.userId], 'HANDYMAN_BLOCKED', ['PRO']);
    if (p.companyId) this.realtime.toCompany(p.companyId, 'company:workers', { companyId: p.companyId });
    await this.emit('handyman.status', { handymanId: id, userId: p.userId, status: 'BLOCKED' });
  }

  /** BLOCKED -> APPROVED when the profile was approved before, else DRAFT. */
  async unblockHandyman(adminId: string, id: string, ip: string | null): Promise<void> {
    const p = await this.handyman(id);
    const next: VerificationStatus = p.approvedAt ? 'APPROVED' : 'DRAFT';
    await inTx(this.prisma, async (tx) => {
      const r = await tx.handymanProfile.updateMany({ where: { id, status: 'BLOCKED' }, data: { status: next, blockedReason: null } });
      if (!r.count) throw new ApiException('INVALID_STATE', { status: p.status });
      await this.audit.log(
        { actorType: 'ADMIN', actorId: adminId, action: 'handyman.unblock', entityType: 'HandymanProfile', entityId: id, before: { status: 'BLOCKED' }, after: { status: next }, ip },
        tx,
      );
    });
    this.realtime.toUser(p.userId, 'profile:updated', { reason: 'UNBLOCKED' });
    await this.emit('handyman.status', { handymanId: id, userId: p.userId, status: next });
  }

  /** Strike counter to 0; open StrikeEvents get clearedAt / clearedByAdminId. */
  async clearStrikes(adminId: string, id: string, ip: string | null): Promise<void> {
    const p = await this.handyman(id);
    const now = this.clock.now();
    await inTx(this.prisma, async (tx) => {
      await tx.handymanProfile.update({ where: { id }, data: { strikes: 0 } });
      const cleared = await tx.strikeEvent.updateMany({ where: { handymanId: id, clearedAt: null }, data: { clearedAt: now, clearedByAdminId: adminId } });
      await this.audit.log(
        { actorType: 'ADMIN', actorId: adminId, action: 'handyman.clearStrikes', entityType: 'HandymanProfile', entityId: id, before: { strikes: p.strikes }, after: { strikes: 0, clearedEvents: cleared.count }, ip },
        tx,
      );
    });
  }

  // -------------------------------------------------------------- companies

  async approveCompany(adminId: string, id: string, ip: string | null): Promise<void> {
    const c = await this.company(id);
    const now = this.clock.now();
    const sub = await inTx(this.prisma, async (tx) => {
      const r = await tx.company.updateMany({ where: { id, status: 'PENDING_REVIEW' }, data: { status: 'APPROVED', approvedAt: now, rejectReason: null } });
      if (!r.count) throw new ApiException('INVALID_STATE', { status: c.status });
      const pending = await tx.verificationSubmission.findFirst({ where: { companyId: id, status: 'PENDING_REVIEW' }, orderBy: { createdAt: 'desc' } });
      const updated = pending
        ? await tx.verificationSubmission.update({ where: { id: pending.id }, data: { status: 'APPROVED', reviewedByAdminId: adminId, reviewedAt: now } })
        : null;
      await this.audit.log(
        { actorType: 'ADMIN', actorId: adminId, action: 'company.approve', entityType: 'Company', entityId: id, before: { status: c.status }, after: { status: 'APPROVED', submissionId: updated?.id ?? null }, ip },
        tx,
      );
      return updated;
    });
    await this.purgeLater(sub);
    const managers = await this.activeMembers(id, 'MANAGER');
    await this.notifications.notifyMany(managers, 'COMPANY_APPROVED', { vars: { company: c.name }, data: { companyId: id } });
    for (const u of managers) this.realtime.toUser(u, 'profile:updated', { reason: 'COMPANY_APPROVED' });
    await this.emit('company.status', { companyId: id, status: 'APPROVED' });
  }

  async rejectCompany(adminId: string, id: string, reason: string, ip: string | null): Promise<void> {
    const c = await this.company(id);
    const now = this.clock.now();
    const sub = await inTx(this.prisma, async (tx) => {
      const r = await tx.company.updateMany({ where: { id, status: 'PENDING_REVIEW' }, data: { status: 'REJECTED', rejectReason: reason } });
      if (!r.count) throw new ApiException('INVALID_STATE', { status: c.status });
      const pending = await tx.verificationSubmission.findFirst({ where: { companyId: id, status: 'PENDING_REVIEW' }, orderBy: { createdAt: 'desc' } });
      const updated = pending
        ? await tx.verificationSubmission.update({
            where: { id: pending.id },
            data: { status: 'REJECTED', reviewedByAdminId: adminId, reviewedAt: now, rejectReason: reason },
          })
        : null;
      await this.audit.log(
        { actorType: 'ADMIN', actorId: adminId, action: 'company.reject', entityType: 'Company', entityId: id, before: { status: c.status }, after: { status: 'REJECTED', reason }, ip },
        tx,
      );
      return updated;
    });
    await this.purgeLater(sub);
    const managers = await this.activeMembers(id, 'MANAGER');
    await this.notifications.notifyMany(managers, 'COMPANY_REJECTED', { vars: { company: c.name, reason }, data: { companyId: id } });
    for (const u of managers) this.realtime.toUser(u, 'profile:updated', { reason: 'COMPANY_REJECTED' });
    await this.emit('company.status', { companyId: id, status: 'REJECTED' });
  }

  /**
   * Any state -> BLOCKED: every worker goes offline, the PRO and PANEL sessions of all ACTIVE members are revoked and
   * their sockets dropped (customer-app sessions are kept), members are notified.
   */
  async blockCompany(adminId: string, id: string, reason: string, ip: string | null): Promise<void> {
    const c = await this.company(id);
    const workers = await this.prisma.handymanProfile.findMany({ where: { companyId: id }, select: { id: true } });
    await inTx(this.prisma, async (tx) => {
      const r = await tx.company.updateMany({ where: { id, status: { not: 'BLOCKED' } }, data: { status: 'BLOCKED', blockedReason: reason } });
      if (!r.count) throw new ApiException('INVALID_STATE', { status: 'BLOCKED' });
      await tx.handymanProfile.updateMany({ where: { companyId: id, isOnline: true }, data: { isOnline: false } });
      await this.audit.log(
        { actorType: 'ADMIN', actorId: adminId, action: 'company.block', entityType: 'Company', entityId: id, before: { status: c.status }, after: { status: 'BLOCKED', reason }, ip },
        tx,
      );
    });
    await this.live.forceOffline(workers.map((w) => w.id));
    const members = await this.activeMembers(id);
    await this.notifications.notifyMany(members, 'ACCOUNT_BLOCKED', { vars: { reason }, data: { companyId: id } });
    for (const u of members) this.realtime.toUser(u, 'profile:updated', { reason: 'COMPANY_BLOCKED' });
    this.realtime.toCompany(id, 'company:workers', { companyId: id });
    await this.live.kickSessions(members, 'COMPANY_BLOCKED', ['PRO', 'PANEL']);
    await this.emit('company.status', { companyId: id, status: 'BLOCKED' });
  }

  async unblockCompany(adminId: string, id: string, ip: string | null): Promise<void> {
    const c = await this.company(id);
    const next: VerificationStatus = c.approvedAt ? 'APPROVED' : 'DRAFT';
    await inTx(this.prisma, async (tx) => {
      const r = await tx.company.updateMany({ where: { id, status: 'BLOCKED' }, data: { status: next, blockedReason: null } });
      if (!r.count) throw new ApiException('INVALID_STATE', { status: c.status });
      await this.audit.log(
        { actorType: 'ADMIN', actorId: adminId, action: 'company.unblock', entityType: 'Company', entityId: id, before: { status: 'BLOCKED' }, after: { status: next }, ip },
        tx,
      );
    });
    for (const u of await this.activeMembers(id, 'MANAGER')) this.realtime.toUser(u, 'profile:updated', { reason: 'COMPANY_UNBLOCKED' });
    await this.emit('company.status', { companyId: id, status: next });
  }

  // ------------------------------------------------------------------ users

  /**
   * ACTIVE -> BLOCKED: every session revoked and every live socket dropped (also via the `user.blocked` event the gateway
   * listens to), the handyman profile (if any) goes offline. BLOCKED/DELETED users -> INVALID_STATE.
   */
  async blockUser(adminId: string, userId: string, reason: string, ip: string | null): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { handymanProfile: { select: { id: true, companyId: true } } } });
    if (!user) throw new ApiException('NOT_FOUND', { entity: 'User' });
    await inTx(this.prisma, async (tx) => {
      const r = await tx.user.updateMany({ where: { id: userId, status: 'ACTIVE' }, data: { status: 'BLOCKED', blockedReason: reason } });
      if (!r.count) throw new ApiException('INVALID_STATE', { status: user.status });
      if (user.handymanProfile) await tx.handymanProfile.update({ where: { id: user.handymanProfile.id }, data: { isOnline: false } });
      await this.audit.log(
        { actorType: 'ADMIN', actorId: adminId, action: 'user.block', entityType: 'User', entityId: userId, before: { status: user.status }, after: { status: 'BLOCKED', reason }, ip },
        tx,
      );
    });
    if (user.handymanProfile) await this.live.forceOffline([user.handymanProfile.id]);
    await this.notifications.notify(userId, 'ACCOUNT_BLOCKED', { vars: { reason } });
    await this.live.kickSessions([userId], 'USER_BLOCKED');
    await this.emit('user.blocked', { userId, reason });
    if (user.handymanProfile?.companyId) {
      this.realtime.toCompany(user.handymanProfile.companyId, 'company:workers', { companyId: user.handymanProfile.companyId });
    }
  }

  async unblockUser(adminId: string, userId: string, ip: string | null): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new ApiException('NOT_FOUND', { entity: 'User' });
    await inTx(this.prisma, async (tx) => {
      const r = await tx.user.updateMany({ where: { id: userId, status: 'BLOCKED' }, data: { status: 'ACTIVE', blockedReason: null } });
      if (!r.count) throw new ApiException('INVALID_STATE', { status: user.status });
      await this.audit.log(
        { actorType: 'ADMIN', actorId: adminId, action: 'user.unblock', entityType: 'User', entityId: userId, before: { status: 'BLOCKED' }, after: { status: 'ACTIVE' }, ip },
        tx,
      );
    });
  }
}
