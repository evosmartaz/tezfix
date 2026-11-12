import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma.service';
import { RealtimeService } from '../../infra/realtime.service';
import { num } from '../../common/mapping';

/**
 * Emits `wallet:updated` to whoever owns a WALLET ledger account: the customer account owner, the solo handyman's user,
 * or the company room. Other lanes call notifyAccount(accountId) after posting fees, penalties or refunds.
 * EARNINGS and platform accounts are ignored (the payload describes a wallet).
 */
@Injectable()
export class WalletEventsService {
  private readonly log = new Logger('WalletEvents');

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  async notifyAccount(accountId: string): Promise<void> {
    try {
      const acc = await this.prisma.ledgerAccount.findUnique({ where: { id: accountId } });
      if (!acc || acc.kind !== 'WALLET') return;
      const posted = num(acc.postedBalance);
      const available = posted - num(acc.heldBalance);
      if (acc.ownerType === 'CUSTOMER_ACCOUNT') {
        const c = await this.prisma.customerAccount.findUnique({
          where: { id: acc.ownerId },
          select: { ownerUserId: true },
        });
        if (c)
          this.realtime.toUser(c.ownerUserId, 'wallet:updated', {
            owner: 'customer',
            companyId: null,
            available,
            posted,
          });
      } else if (acc.ownerType === 'HANDYMAN') {
        const h = await this.prisma.handymanProfile.findUnique({
          where: { id: acc.ownerId },
          select: { userId: true, kind: true },
        });
        if (h && h.kind === 'SOLO')
          this.realtime.toUser(h.userId, 'wallet:updated', {
            owner: 'handyman',
            companyId: null,
            available,
            posted,
          });
      } else if (acc.ownerType === 'COMPANY') {
        this.realtime.toCompany(acc.ownerId, 'wallet:updated', {
          owner: 'company',
          companyId: acc.ownerId,
          available,
          posted,
        });
      }
    } catch (err) {
      // Notifications are hints; never fail a money operation because of them.
      this.log.warn(`notifyAccount(${accountId}) failed: ${(err as Error).message}`);
    }
  }

  async notifyAccounts(accountIds: Array<string | null | undefined>): Promise<void> {
    for (const id of new Set(accountIds.filter((v): v is string => !!v))) await this.notifyAccount(id);
  }
}
