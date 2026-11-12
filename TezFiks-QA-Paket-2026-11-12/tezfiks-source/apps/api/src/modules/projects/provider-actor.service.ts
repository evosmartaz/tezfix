import { Injectable } from '@nestjs/common';
import type { ProviderType } from '@tezfiks/shared';
import { PrismaService, type Db } from '../../infra/prisma.service';
import { ApiException } from '../../common/http/api-exception';
import { WalletAccessService } from '../wallet/wallet-access.service';

/** Who acts on the provider side of a B2B project: a solo handyman, or a company manager acting for the company. */
export interface ProviderActor {
  type: ProviderType;
  userId: string;
  /** SOLO only. */
  handymanId: string | null;
  /** COMPANY only. */
  companyId: string | null;
  walletAccountId: string;
  earningsAccountId: string;
  approved: boolean;
}

/** Provider identity of a quote / an awarded project. */
export interface ProviderRef {
  providerType: ProviderType;
  handymanId: string | null;
  companyId: string | null;
}

/**
 * Resolves the provider actor of a request (api.providerProjects.*): `companyId` given -> the caller must be an ACTIVE manager of
 * that company (NOT_FOUND / NOT_COMPANY_MANAGER); otherwise the caller's SOLO handyman profile (NOT_FOUND without one,
 * FORBIDDEN for company workers, who have no money of their own).
 */
@Injectable()
export class ProviderActorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallets: WalletAccessService,
  ) {}

  async resolve(userId: string, companyId?: string | null): Promise<ProviderActor> {
    if (companyId) {
      const company = await this.wallets.managedCompany(userId, companyId);
      return {
        type: 'COMPANY',
        userId,
        handymanId: null,
        companyId: company.id,
        walletAccountId: company.walletAccountId,
        earningsAccountId: company.earningsAccountId,
        approved: company.status === 'APPROVED',
      };
    }
    const solo = await this.wallets.soloHandyman(userId);
    return {
      type: 'SOLO',
      userId,
      handymanId: solo.profile.id,
      companyId: null,
      walletAccountId: solo.walletAccountId,
      earningsAccountId: solo.earningsAccountId,
      approved: solo.profile.status === 'APPROVED',
    };
  }

  /** Throws HANDYMAN_NOT_APPROVED / COMPANY_NOT_APPROVED unless the provider is approved (read inside `db`, e.g. a transaction). */
  async requireApproved(actor: ProviderActor, db: Db = this.prisma): Promise<void> {
    if (actor.type === 'COMPANY') {
      const c = await db.company.findUnique({ where: { id: actor.companyId! }, select: { status: true } });
      if (c?.status !== 'APPROVED') throw new ApiException('COMPANY_NOT_APPROVED', { status: c?.status ?? null });
      const m = await db.companyMember.findFirst({
        where: { companyId: actor.companyId!, userId: actor.userId, role: 'MANAGER', status: 'ACTIVE' },
        select: { id: true },
      });
      if (!m) throw new ApiException('NOT_COMPANY_MANAGER');
      return;
    }
    const p = await db.handymanProfile.findUnique({ where: { id: actor.handymanId! }, select: { status: true } });
    if (p?.status !== 'APPROVED') throw new ApiException('HANDYMAN_NOT_APPROVED', { status: p?.status ?? null });
  }

  /** Trades and service cells of the provider (dispatch rule for projects: the trade, and a service cell covering the site). */
  async coverage(actor: ProviderActor, db: Db = this.prisma): Promise<{ tradeIds: string[]; cells: string[] }> {
    if (actor.type === 'COMPANY') {
      const [trades, cells] = await Promise.all([
        db.companyTrade.findMany({ where: { companyId: actor.companyId! }, select: { categoryId: true } }),
        db.companyServiceCell.findMany({ where: { companyId: actor.companyId! }, select: { cell7: true } }),
      ]);
      return { tradeIds: trades.map((t) => t.categoryId), cells: cells.map((c) => c.cell7) };
    }
    const [trades, cells] = await Promise.all([
      db.handymanTrade.findMany({ where: { handymanId: actor.handymanId! }, select: { categoryId: true } }),
      db.handymanServiceCell.findMany({ where: { handymanId: actor.handymanId! }, select: { cell7: true } }),
    ]);
    return { tradeIds: trades.map((t) => t.categoryId), cells: cells.map((c) => c.cell7) };
  }

  /** True when the provider has the project's trade and a service cell covering the project, and is not the project's own customer. */
  async isEligible(actor: ProviderActor, project: { categoryId: string; cell7: string; createdByUserId: string }, db: Db = this.prisma): Promise<boolean> {
    if (project.createdByUserId === actor.userId) return false;
    if (actor.type === 'COMPANY') {
      const n = await db.company.count({
        where: {
          id: actor.companyId!,
          trades: { some: { categoryId: project.categoryId } },
          serviceCells: { some: { cell7: project.cell7 } },
        },
      });
      return n > 0;
    }
    const n = await db.handymanProfile.count({
      where: {
        id: actor.handymanId!,
        trades: { some: { categoryId: project.categoryId } },
        serviceCells: { some: { cell7: project.cell7 } },
      },
    });
    return n > 0;
  }

  /** The actor's quote filter (Quote where-clause). */
  quoteWhere(actor: ProviderActor): { handymanId: string } | { companyId: string } {
    return actor.type === 'COMPANY' ? { companyId: actor.companyId! } : { handymanId: actor.handymanId! };
  }

  /** True when the quote / awarded provider is this actor. */
  owns(actor: ProviderActor, ref: ProviderRef): boolean {
    return actor.type === 'COMPANY' ? ref.companyId === actor.companyId : ref.handymanId === actor.handymanId;
  }

  /** Users to notify for a provider: the solo handyman, or every ACTIVE manager of the company. */
  async userIdsOf(ref: ProviderRef, db: Db = this.prisma): Promise<string[]> {
    if (ref.providerType === 'COMPANY' && ref.companyId) {
      const ms = await db.companyMember.findMany({
        where: { companyId: ref.companyId, role: 'MANAGER', status: 'ACTIVE', user: { status: 'ACTIVE' } },
        select: { userId: true },
      });
      return ms.map((m) => m.userId);
    }
    if (ref.handymanId) {
      const p = await db.handymanProfile.findUnique({ where: { id: ref.handymanId }, select: { userId: true } });
      return p ? [p.userId] : [];
    }
    return [];
  }

  /** Ledger WALLET / EARNINGS accounts of a provider. */
  async accountsOf(ref: ProviderRef, db: Db = this.prisma): Promise<{ walletAccountId: string | null; earningsAccountId: string | null }> {
    if (ref.providerType === 'COMPANY' && ref.companyId) {
      const c = await db.company.findUnique({ where: { id: ref.companyId }, select: { walletAccountId: true, earningsAccountId: true } });
      return { walletAccountId: c?.walletAccountId ?? null, earningsAccountId: c?.earningsAccountId ?? null };
    }
    const p = ref.handymanId
      ? await db.handymanProfile.findUnique({ where: { id: ref.handymanId }, select: { walletAccountId: true, earningsAccountId: true } })
      : null;
    return { walletAccountId: p?.walletAccountId ?? null, earningsAccountId: p?.earningsAccountId ?? null };
  }

  /**
   * Users to notify about a new project at `cell7` in category `categoryId`: approved solo handymen with the trade whose service cells
   * cover the cell, and ACTIVE managers of approved companies with the trade covering it. The project's own customer is left out.
   */
  async eligibleUserIds(categoryId: string, cell7: string, excludeUserId: string): Promise<string[]> {
    const [solos, managers] = await Promise.all([
      this.prisma.handymanProfile.findMany({
        where: {
          kind: 'SOLO',
          status: 'APPROVED',
          user: { status: 'ACTIVE' },
          trades: { some: { categoryId } },
          serviceCells: { some: { cell7 } },
        },
        select: { userId: true },
      }),
      this.prisma.companyMember.findMany({
        where: {
          role: 'MANAGER',
          status: 'ACTIVE',
          user: { status: 'ACTIVE' },
          company: { status: 'APPROVED', trades: { some: { categoryId } }, serviceCells: { some: { cell7 } } },
        },
        select: { userId: true },
      }),
    ]);
    return [...new Set([...solos, ...managers].map((r) => r.userId))].filter((id) => id !== excludeUserId);
  }
}
