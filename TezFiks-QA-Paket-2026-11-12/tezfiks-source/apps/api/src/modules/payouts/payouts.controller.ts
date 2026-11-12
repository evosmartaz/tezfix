import { Controller } from '@nestjs/common';
import { api } from '@tezfiks/shared';
import { Route } from '../../common/http/route.decorator';
import { Input, type RouteInput } from '../../common/http/input.decorator';
import { ClientIp, CurrentAdmin, CurrentUser } from '../../common/auth/current.decorators';
import type { AdminPrincipal, UserPrincipal } from '../../common/auth/types';
import { AuditService } from '../../common/audit/audit.service';
import { WalletAccessService } from '../wallet/wallet-access.service';
import { PayoutsService, type PayoutOwner } from './payouts.service';

/** Earnings and payout methods (solo handyman in the pro app, company managers in the panel) and admin payouts. */
@Controller()
export class PayoutsController {
  constructor(
    private readonly payouts: PayoutsService,
    private readonly access: WalletAccessService,
    private readonly audit: AuditService,
  ) {}

  private async soloOwner(userId: string): Promise<PayoutOwner> {
    const h = await this.access.soloHandyman(userId);
    return { type: 'HANDYMAN', handymanId: h.profile.id, earningsAccountId: h.earningsAccountId };
  }

  private async companyOwner(userId: string, companyId: string): Promise<PayoutOwner> {
    const c = await this.access.managedCompany(userId, companyId);
    return { type: 'COMPANY', companyId: c.id, earningsAccountId: c.earningsAccountId };
  }

  @Route(api.pro.earnings)
  async proEarnings(@CurrentUser() user: UserPrincipal) {
    return this.payouts.earnings(await this.soloOwner(user.userId));
  }

  @Route(api.pro.getPayoutMethod)
  async proGetPayoutMethod(@CurrentUser() user: UserPrincipal) {
    return { method: await this.payouts.getMethod(await this.soloOwner(user.userId)) };
  }

  @Route(api.pro.setPayoutMethod)
  async proSetPayoutMethod(
    @CurrentUser() user: UserPrincipal,
    @Input() input: RouteInput<typeof api.pro.setPayoutMethod>,
  ) {
    return this.payouts.setMethod(await this.soloOwner(user.userId), input.body);
  }

  @Route(api.company.earnings)
  async companyEarnings(
    @CurrentUser() user: UserPrincipal,
    @Input() input: RouteInput<typeof api.company.earnings>,
  ) {
    return this.payouts.earnings(await this.companyOwner(user.userId, input.params.companyId));
  }

  @Route(api.company.getPayoutMethod)
  async companyGetPayoutMethod(
    @CurrentUser() user: UserPrincipal,
    @Input() input: RouteInput<typeof api.company.getPayoutMethod>,
  ) {
    return {
      method: await this.payouts.getMethod(await this.companyOwner(user.userId, input.params.companyId)),
    };
  }

  @Route(api.company.setPayoutMethod)
  async companySetPayoutMethod(
    @CurrentUser() user: UserPrincipal,
    @Input() input: RouteInput<typeof api.company.setPayoutMethod>,
  ) {
    return this.payouts.setMethod(await this.companyOwner(user.userId, input.params.companyId), input.body);
  }

  @Route(api.admin.payouts)
  async adminPayouts(@Input() input: RouteInput<typeof api.admin.payouts>) {
    return this.payouts.listAdmin(input.query);
  }

  @Route(api.admin.runPayouts)
  async runPayouts(@CurrentAdmin() admin: AdminPrincipal, @ClientIp() ip: string | null) {
    const result = await this.payouts.runPayouts();
    await this.audit.log({
      actorType: 'ADMIN',
      actorId: admin.adminId,
      action: 'payouts.run',
      entityType: 'Payout',
      entityId: null,
      after: result,
      ip,
    });
    return result;
  }

  @Route(api.admin.markPayoutPaid)
  async markPaid(
    @CurrentAdmin() admin: AdminPrincipal,
    @Input() input: RouteInput<typeof api.admin.markPayoutPaid>,
    @ClientIp() ip: string | null,
  ) {
    return this.payouts.markPaid(input.params.id, admin.adminId, ip);
  }

  @Route(api.admin.markPayoutFailed)
  async markFailed(
    @CurrentAdmin() admin: AdminPrincipal,
    @Input() input: RouteInput<typeof api.admin.markPayoutFailed>,
    @ClientIp() ip: string | null,
  ) {
    return this.payouts.markFailed(input.params.id, admin.adminId, input.body.reason, ip);
  }
}
