import { Controller } from '@nestjs/common';
import { api, type Locale } from '@tezfiks/shared';
import { Route } from '../../common/http/route.decorator';
import { Input, type RouteInput } from '../../common/http/input.decorator';
import { ClientIp, CurrentAdmin, ReqLocale } from '../../common/auth/current.decorators';
import type { AdminPrincipal } from '../../common/auth/types';
import { AdminProvidersService } from './admin-providers.service';
import { ProviderReviewService } from './provider-review.service';

/** TezFiks admin: handymen and companies (lists, details with KYC review, decisions) and user blocking. */
@Controller()
export class AdminProvidersController {
  constructor(
    private readonly read: AdminProvidersService,
    private readonly review: ProviderReviewService,
  ) {}

  // ------------------------------------------------------------- handymen

  @Route(api.admin.handymen)
  async handymen(@Input() input: RouteInput<typeof api.admin.handymen>, @ReqLocale() locale: Locale) {
    return this.read.listHandymen(input.query, locale);
  }

  @Route(api.admin.handyman)
  async handyman(@CurrentAdmin() admin: AdminPrincipal, @Input() input: RouteInput<typeof api.admin.handyman>, @ReqLocale() locale: Locale) {
    return this.read.handymanDetail(input.params.id, admin.adminId, locale);
  }

  @Route(api.admin.approveHandyman)
  async approveHandyman(
    @CurrentAdmin() admin: AdminPrincipal,
    @Input() input: RouteInput<typeof api.admin.approveHandyman>,
    @ClientIp() ip: string | null,
    @ReqLocale() locale: Locale,
  ) {
    await this.review.approveHandyman(admin.adminId, input.params.id, input.body.extracted, ip);
    return this.read.handymanDetail(input.params.id, admin.adminId, locale);
  }

  @Route(api.admin.rejectHandyman)
  async rejectHandyman(
    @CurrentAdmin() admin: AdminPrincipal,
    @Input() input: RouteInput<typeof api.admin.rejectHandyman>,
    @ClientIp() ip: string | null,
    @ReqLocale() locale: Locale,
  ) {
    await this.review.rejectHandyman(admin.adminId, input.params.id, input.body.reason, ip);
    return this.read.handymanDetail(input.params.id, admin.adminId, locale);
  }

  @Route(api.admin.blockHandyman)
  async blockHandyman(
    @CurrentAdmin() admin: AdminPrincipal,
    @Input() input: RouteInput<typeof api.admin.blockHandyman>,
    @ClientIp() ip: string | null,
    @ReqLocale() locale: Locale,
  ) {
    await this.review.blockHandyman(admin.adminId, input.params.id, input.body.reason, ip);
    return this.read.handymanDetail(input.params.id, admin.adminId, locale);
  }

  @Route(api.admin.unblockHandyman)
  async unblockHandyman(
    @CurrentAdmin() admin: AdminPrincipal,
    @Input() input: RouteInput<typeof api.admin.unblockHandyman>,
    @ClientIp() ip: string | null,
    @ReqLocale() locale: Locale,
  ) {
    await this.review.unblockHandyman(admin.adminId, input.params.id, ip);
    return this.read.handymanDetail(input.params.id, admin.adminId, locale);
  }

  @Route(api.admin.clearStrikes)
  async clearStrikes(
    @CurrentAdmin() admin: AdminPrincipal,
    @Input() input: RouteInput<typeof api.admin.clearStrikes>,
    @ClientIp() ip: string | null,
    @ReqLocale() locale: Locale,
  ) {
    await this.review.clearStrikes(admin.adminId, input.params.id, ip);
    return this.read.handymanDetail(input.params.id, admin.adminId, locale);
  }

  // ------------------------------------------------------------- companies

  @Route(api.admin.companies)
  async companies(@Input() input: RouteInput<typeof api.admin.companies>) {
    return this.read.listCompanies(input.query);
  }

  @Route(api.admin.company)
  async company(@CurrentAdmin() admin: AdminPrincipal, @Input() input: RouteInput<typeof api.admin.company>, @ReqLocale() locale: Locale) {
    return this.read.companyDetail(input.params.id, admin.adminId, locale);
  }

  @Route(api.admin.approveCompany)
  async approveCompany(
    @CurrentAdmin() admin: AdminPrincipal,
    @Input() input: RouteInput<typeof api.admin.approveCompany>,
    @ClientIp() ip: string | null,
    @ReqLocale() locale: Locale,
  ) {
    await this.review.approveCompany(admin.adminId, input.params.id, ip);
    return this.read.companyDetail(input.params.id, admin.adminId, locale);
  }

  @Route(api.admin.rejectCompany)
  async rejectCompany(
    @CurrentAdmin() admin: AdminPrincipal,
    @Input() input: RouteInput<typeof api.admin.rejectCompany>,
    @ClientIp() ip: string | null,
    @ReqLocale() locale: Locale,
  ) {
    await this.review.rejectCompany(admin.adminId, input.params.id, input.body.reason, ip);
    return this.read.companyDetail(input.params.id, admin.adminId, locale);
  }

  @Route(api.admin.blockCompany)
  async blockCompany(
    @CurrentAdmin() admin: AdminPrincipal,
    @Input() input: RouteInput<typeof api.admin.blockCompany>,
    @ClientIp() ip: string | null,
    @ReqLocale() locale: Locale,
  ) {
    await this.review.blockCompany(admin.adminId, input.params.id, input.body.reason, ip);
    return this.read.companyDetail(input.params.id, admin.adminId, locale);
  }

  @Route(api.admin.unblockCompany)
  async unblockCompany(
    @CurrentAdmin() admin: AdminPrincipal,
    @Input() input: RouteInput<typeof api.admin.unblockCompany>,
    @ClientIp() ip: string | null,
    @ReqLocale() locale: Locale,
  ) {
    await this.review.unblockCompany(admin.adminId, input.params.id, ip);
    return this.read.companyDetail(input.params.id, admin.adminId, locale);
  }

  // ----------------------------------------------------------------- users

  @Route(api.admin.blockUser)
  async blockUser(@CurrentAdmin() admin: AdminPrincipal, @Input() input: RouteInput<typeof api.admin.blockUser>, @ClientIp() ip: string | null) {
    await this.review.blockUser(admin.adminId, input.params.id, input.body.reason, ip);
    return { ok: true as const };
  }

  @Route(api.admin.unblockUser)
  async unblockUser(@CurrentAdmin() admin: AdminPrincipal, @Input() input: RouteInput<typeof api.admin.unblockUser>, @ClientIp() ip: string | null) {
    await this.review.unblockUser(admin.adminId, input.params.id, ip);
    return { ok: true as const };
  }
}
