import { Controller } from '@nestjs/common';
import { api } from '@tezfiks/shared';
import { Route } from '../../common/http/route.decorator';
import { Input, type RouteInput } from '../../common/http/input.decorator';
import { ClientIp, CurrentAdmin, CurrentUser } from '../../common/auth/current.decorators';
import type { AdminPrincipal, UserPrincipal } from '../../common/auth/types';
import { LedgerService } from '../ledger/ledger.service';
import { WalletAccessService } from './wallet-access.service';
import { WalletAdminService } from './wallet-admin.service';

/** Wallet reads for the caller (customer / solo handyman), company wallet reads, and admin wallet tools. */
@Controller()
export class WalletController {
  constructor(
    private readonly access: WalletAccessService,
    private readonly ledger: LedgerService,
    private readonly admin: WalletAdminService,
  ) {}

  @Route(api.wallet.get)
  async get(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.wallet.get>) {
    const w = await this.access.resolveSelf(user, input.query.owner);
    return this.ledger.summary(w.accountId);
  }

  @Route(api.wallet.transactions)
  async transactions(
    @CurrentUser() user: UserPrincipal,
    @Input() input: RouteInput<typeof api.wallet.transactions>,
  ) {
    const w = await this.access.resolveSelf(user, input.query.owner);
    return this.ledger.listTransactions(w.accountId, {
      cursor: input.query.cursor,
      limit: input.query.limit,
    });
  }

  @Route(api.company.wallet)
  async companyWallet(
    @CurrentUser() user: UserPrincipal,
    @Input() input: RouteInput<typeof api.company.wallet>,
  ) {
    const company = await this.access.managedCompany(user.userId, input.params.companyId);
    return this.ledger.summary(company.walletAccountId);
  }

  @Route(api.company.walletTransactions)
  async companyWalletTransactions(
    @CurrentUser() user: UserPrincipal,
    @Input() input: RouteInput<typeof api.company.walletTransactions>,
  ) {
    const company = await this.access.managedCompany(user.userId, input.params.companyId);
    return this.ledger.listTransactions(company.walletAccountId, {
      cursor: input.query.cursor,
      limit: input.query.limit,
    });
  }

  @Route(api.admin.adjustWallet)
  async adjustWallet(
    @CurrentAdmin() admin: AdminPrincipal,
    @Input() input: RouteInput<typeof api.admin.adjustWallet>,
    @ClientIp() ip: string | null,
  ) {
    return this.admin.adjust(admin.adminId, input.body, ip);
  }

  @Route(api.admin.ledger)
  async ledgerTransactions(@Input() input: RouteInput<typeof api.admin.ledger>) {
    return this.admin.listTransactions(input.query);
  }
}
