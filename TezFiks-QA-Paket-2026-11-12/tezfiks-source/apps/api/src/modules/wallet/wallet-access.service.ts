import { Injectable } from '@nestjs/common';
import type { AppKind } from '@tezfiks/shared';
import { PrismaService, type Db } from '../../infra/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { ApiException } from '../../common/http/api-exception';
import type { Company, HandymanProfile } from '../../generated/prisma/client';

export type SelfWalletOwner = 'customer' | 'handyman';

export interface SelfWallet {
  owner: SelfWalletOwner;
  /** Ledger WALLET account id. */
  accountId: string;
  customerAccountId: string | null;
  handymanId: string | null;
}

export interface SoloHandyman {
  profile: HandymanProfile;
  walletAccountId: string;
  earningsAccountId: string;
}

/**
 * Resolves which ledger accounts a caller may use (spec section 7, plan lane A2 "Wallet resolution").
 * customer app / panel -> the caller's customer account wallet; pro app -> the caller's SOLO handyman wallet.
 * Company money is only reachable by ACTIVE managers of that company.
 */
@Injectable()
export class WalletAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  /** The default owner for a session app when the client does not pass `owner`. */
  static defaultOwner(app: AppKind): SelfWalletOwner {
    return app === 'PRO' ? 'handyman' : 'customer';
  }

  async resolveSelf(
    user: { userId: string; app: AppKind },
    owner?: SelfWalletOwner | null,
  ): Promise<SelfWallet> {
    const which = owner ?? WalletAccessService.defaultOwner(user.app);
    if (which === 'customer') {
      const c = await this.customerWallet(user.userId);
      return {
        owner: 'customer',
        accountId: c.walletAccountId,
        customerAccountId: c.customerAccountId,
        handymanId: null,
      };
    }
    const h = await this.soloHandyman(user.userId);
    return {
      owner: 'handyman',
      accountId: h.walletAccountId,
      customerAccountId: null,
      handymanId: h.profile.id,
    };
  }

  /** The caller's customer account and its wallet; CUSTOMER_ACCOUNT_REQUIRED when the user has none. */
  async customerWallet(
    userId: string,
    db: Db = this.prisma,
  ): Promise<{ customerAccountId: string; walletAccountId: string }> {
    const acc = await db.customerAccount.findUnique({
      where: { ownerUserId: userId },
      select: { id: true, walletAccountId: true },
    });
    if (!acc) throw new ApiException('CUSTOMER_ACCOUNT_REQUIRED');
    return { customerAccountId: acc.id, walletAccountId: acc.walletAccountId };
  }

  /**
   * The caller's SOLO handyman profile with its WALLET and EARNINGS accounts (created on first use when missing).
   * Company workers have no money of their own -> FORBIDDEN; no profile -> NOT_FOUND.
   */
  async soloHandyman(userId: string): Promise<SoloHandyman> {
    let profile = await this.prisma.handymanProfile.findUnique({ where: { userId } });
    if (!profile) throw new ApiException('NOT_FOUND', { entity: 'HandymanProfile' });
    if (profile.kind !== 'SOLO') throw new ApiException('FORBIDDEN', { reason: 'COMPANY_WORKER' });
    if (!profile.walletAccountId || !profile.earningsAccountId) {
      const wallet = await this.ledger.ensureAccount('HANDYMAN', profile.id, 'WALLET');
      const earnings = await this.ledger.ensureAccount('HANDYMAN', profile.id, 'EARNINGS');
      profile = await this.prisma.handymanProfile.update({
        where: { id: profile.id },
        data: { walletAccountId: wallet.id, earningsAccountId: earnings.id },
      });
    }
    return {
      profile,
      walletAccountId: profile.walletAccountId!,
      earningsAccountId: profile.earningsAccountId!,
    };
  }

  /** The company when the caller is one of its ACTIVE managers. Unknown company -> NOT_FOUND, otherwise NOT_COMPANY_MANAGER. */
  async managedCompany(userId: string, companyId: string): Promise<Company> {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new ApiException('NOT_FOUND', { entity: 'Company' });
    const member = await this.prisma.companyMember.findUnique({
      where: { companyId_userId: { companyId, userId } },
    });
    if (!member || member.status !== 'ACTIVE' || member.role !== 'MANAGER')
      throw new ApiException('NOT_COMPANY_MANAGER');
    return company;
  }

  /** True when the user is an ACTIVE manager of the company (no throw). */
  async isCompanyManager(userId: string, companyId: string): Promise<boolean> {
    const member = await this.prisma.companyMember.findUnique({
      where: { companyId_userId: { companyId, userId } },
    });
    return !!member && member.status === 'ACTIVE' && member.role === 'MANAGER';
  }
}
