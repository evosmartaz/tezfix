import { Injectable } from '@nestjs/common';
import type { CompanyRole, EndpointBody, Locale, ProProfileResponse, api } from '@tezfiks/shared';
import { PrismaService, inTx, type Tx } from '../../infra/prisma.service';
import { Clock } from '../../infra/clock';
import { RealtimeService } from '../../infra/realtime.service';
import { RateLimiter } from '../../infra/rate-limiter';
import { newId } from '../../infra/ids';
import { ApiException } from '../../common/http/api-exception';
import { ProviderViewsService } from '../pro/provider-views.service';
import { ProviderLiveService } from '../pro/provider-live.service';
import type { CompanyInvite } from '../../generated/prisma/client';

type AcceptBody = EndpointBody<typeof api.invites.accept>;
export type InviteInvalidReason = 'EXPIRED' | 'REVOKED' | 'USED_UP';

export interface InvitePreview {
  companyName: string;
  role: CompanyRole;
  expiresAt: string;
  valid: boolean;
  reason: InviteInvalidReason | 'COMPANY_NOT_APPROVED' | null;
}

/** Public preview rate limit per client IP. */
const PREVIEWS_PER_MINUTE = 30;

/** Company invite links: public preview and accept (join as WORKER or MANAGER). */
@Injectable()
export class InvitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly realtime: RealtimeService,
    private readonly rateLimiter: RateLimiter,
    private readonly views: ProviderViewsService,
    private readonly live: ProviderLiveService,
  ) {}

  /** Why the invite itself cannot be used now (revoked / expired / used up), or null. */
  invalidReason(i: Pick<CompanyInvite, 'revokedAt' | 'expiresAt' | 'usedCount' | 'maxUses'>): InviteInvalidReason | null {
    if (i.revokedAt) return 'REVOKED';
    if (i.expiresAt.getTime() <= this.clock.nowMs()) return 'EXPIRED';
    if (i.usedCount >= i.maxUses) return 'USED_UP';
    return null;
  }

  async preview(token: string, ip: string | null): Promise<InvitePreview> {
    await this.rateLimiter.enforce(`invites:preview:${ip ?? 'unknown'}`, PREVIEWS_PER_MINUTE, 60);
    const invite = await this.prisma.companyInvite.findUnique({
      where: { token },
      include: { company: { select: { name: true, status: true } } },
    });
    if (!invite) throw new ApiException('NOT_FOUND', { entity: 'CompanyInvite' });
    const reason = this.invalidReason(invite) ?? (invite.company.status !== 'APPROVED' ? 'COMPANY_NOT_APPROVED' : null);
    return { companyName: invite.company.name, role: invite.role, expiresAt: invite.expiresAt.toISOString(), valid: !reason, reason };
  }

  /**
   * Joins the invite's company. WORKER: the caller must have no handyman profile, or a DRAFT company-less one (a DRAFT
   * solo profile is converted when its wallets are empty); the worker profile is APPROVED at once (the company is verified)
   * with the company's trades or the given subset. MANAGER: membership only. usedCount is incremented under a row lock,
   * so a 1-use invite accepted twice at once lets exactly one caller in.
   */
  async accept(userId: string, token: string, body: AcceptBody, locale: Locale): Promise<ProProfileResponse> {
    let companyId = '';
    await inTx(this.prisma, async (tx) => {
      const locked = await tx.$queryRawUnsafe<Array<{ id: string }>>('SELECT id FROM company_invites WHERE token = $1 FOR UPDATE', token);
      if (!locked.length) throw new ApiException('INVITE_INVALID', { reason: 'NOT_FOUND' });
      const invite = await tx.companyInvite.findUniqueOrThrow({ where: { id: locked[0]!.id } });
      const reason = this.invalidReason(invite);
      if (reason) throw new ApiException('INVITE_INVALID', { reason });
      const company = await tx.company.findUniqueOrThrow({ where: { id: invite.companyId } });
      if (company.status !== 'APPROVED') throw new ApiException('COMPANY_NOT_APPROVED', { companyId: company.id });
      companyId = company.id;
      // Serializes one user's concurrent accepts (two invites at once): the loser then sees the winner's membership
      // / profile and gets ALREADY_IN_COMPANY instead of a unique-index violation.
      await tx.$queryRawUnsafe('SELECT id FROM users WHERE id = $1::uuid FOR UPDATE', userId);

      const memberships = await tx.companyMember.findMany({ where: { userId, status: 'ACTIVE' }, select: { companyId: true } });
      if (memberships.some((m) => m.companyId === company.id)) throw new ApiException('ALREADY_IN_COMPANY', { companyId: company.id });

      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      const firstName = body.firstName ?? user.firstName;
      const lastName = body.lastName ?? user.lastName;
      if (!firstName || !lastName) throw new ApiException('PROFILE_INCOMPLETE', { fields: ['firstName', 'lastName'] });
      if (body.firstName || body.lastName) await tx.user.update({ where: { id: userId }, data: { firstName, lastName } });

      const now = this.clock.now();
      if (invite.role === 'WORKER') {
        const other = memberships.find((m) => m.companyId !== company.id);
        if (other) throw new ApiException('ALREADY_IN_COMPANY', { companyId: other.companyId });
        const companyTrades = (await tx.companyTrade.findMany({ where: { companyId: company.id }, select: { categoryId: true } })).map(
          (t) => t.categoryId,
        );
        const tradeIds = body.tradeIds ? await this.views.validateTrades(body.tradeIds, { within: companyTrades }, tx) : companyTrades;
        const profileData = {
          kind: 'COMPANY_WORKER' as const,
          companyId: company.id,
          status: 'APPROVED' as const,
          approvedAt: now,
          rejectReason: null,
          blockedReason: null,
          serviceRadiusKm: company.serviceRadiusKm,
          baseLat: company.baseLat,
          baseLng: company.baseLng,
          baseCell7: company.baseCell7,
        };
        const profile = await tx.handymanProfile.findUnique({ where: { userId } });
        if (profile) {
          if (profile.companyId) throw new ApiException('ALREADY_IN_COMPANY', { companyId: profile.companyId });
          if (profile.status !== 'DRAFT') throw new ApiException('ALREADY_HANDYMAN');
          if (profile.kind === 'SOLO' && (await this.hasMoney(tx, [profile.walletAccountId, profile.earningsAccountId]))) {
            throw new ApiException('ALREADY_HANDYMAN', { reason: 'WALLET_NOT_EMPTY' });
          }
          await tx.handymanProfile.update({ where: { id: profile.id }, data: profileData });
          await tx.handymanTrade.deleteMany({ where: { handymanId: profile.id } });
          await tx.handymanTrade.createMany({ data: tradeIds.map((categoryId) => ({ handymanId: profile.id, categoryId })) });
          await tx.handymanServiceCell.deleteMany({ where: { handymanId: profile.id } });
        } else {
          await tx.handymanProfile.create({
            data: { id: newId(), userId, ...profileData, createdAt: now, trades: { create: tradeIds.map((categoryId) => ({ categoryId })) } },
          });
        }
      }

      const existing = await tx.companyMember.findUnique({ where: { companyId_userId: { companyId: company.id, userId } } });
      if (existing) {
        await tx.companyMember.update({
          where: { id: existing.id },
          data: { role: invite.role, status: 'ACTIVE', joinedAt: now, removedAt: null },
        });
      } else {
        await tx.companyMember.create({ data: { companyId: company.id, userId, role: invite.role, joinedAt: now } });
      }
      await tx.companyInvite.update({ where: { id: invite.id }, data: { usedCount: { increment: 1 } } });
    });
    await this.live.refreshUsers([userId]);
    this.realtime.toUser(userId, 'profile:updated', { reason: 'JOINED_COMPANY' });
    this.realtime.toCompany(companyId, 'company:workers', { companyId });
    return this.views.profileResponse(userId, locale);
  }

  private async hasMoney(tx: Tx, accountIds: Array<string | null>): Promise<boolean> {
    const ids = accountIds.filter((x): x is string => !!x);
    if (!ids.length) return false;
    const rows = await tx.ledgerAccount.findMany({ where: { id: { in: ids } }, select: { postedBalance: true, heldBalance: true } });
    return rows.some((r) => r.postedBalance !== 0n || r.heldBalance !== 0n);
  }
}
