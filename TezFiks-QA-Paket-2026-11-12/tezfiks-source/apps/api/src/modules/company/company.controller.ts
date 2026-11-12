import { Controller } from '@nestjs/common';
import { api, type Locale } from '@tezfiks/shared';
import { Route } from '../../common/http/route.decorator';
import { Input, type RouteInput } from '../../common/http/input.decorator';
import { CurrentUser, ReqLocale } from '../../common/auth/current.decorators';
import type { UserPrincipal } from '../../common/auth/types';
import { CompanyService } from './company.service';

/** Company profile, settings, members, invites and live workers (ACTIVE managers only). */
@Controller()
export class CompanyController {
  constructor(private readonly company: CompanyService) {}

  @Route(api.company.get)
  async get(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.company.get>, @ReqLocale() locale: Locale) {
    return this.company.get(user.userId, input.params.companyId, locale);
  }

  @Route(api.company.dashboard)
  async dashboard(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.company.dashboard>) {
    return this.company.dashboard(user.userId, input.params.companyId);
  }

  @Route(api.company.updateSettings)
  async updateSettings(
    @CurrentUser() user: UserPrincipal,
    @Input() input: RouteInput<typeof api.company.updateSettings>,
    @ReqLocale() locale: Locale,
  ) {
    return this.company.updateSettings(user.userId, input.params.companyId, input.body, locale);
  }

  @Route(api.company.members)
  async members(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.company.members>, @ReqLocale() locale: Locale) {
    return this.company.members(user.userId, input.params.companyId, locale);
  }

  @Route(api.company.updateMember)
  async updateMember(
    @CurrentUser() user: UserPrincipal,
    @Input() input: RouteInput<typeof api.company.updateMember>,
    @ReqLocale() locale: Locale,
  ) {
    return this.company.updateMember(user.userId, input.params.companyId, input.params.userId, input.body, locale);
  }

  @Route(api.company.removeMember)
  async removeMember(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.company.removeMember>) {
    return this.company.removeMember(user.userId, input.params.companyId, input.params.userId);
  }

  @Route(api.company.invites)
  async invites(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.company.invites>) {
    return this.company.invites(user.userId, input.params.companyId);
  }

  @Route(api.company.createInvite)
  async createInvite(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.company.createInvite>) {
    return this.company.createInvite(user.userId, input.params.companyId, input.body);
  }

  @Route(api.company.revokeInvite)
  async revokeInvite(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.company.revokeInvite>) {
    return this.company.revokeInvite(user.userId, input.params.companyId, input.params.inviteId);
  }

  @Route(api.company.workersLive)
  async workersLive(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.company.workersLive>) {
    return this.company.workersLive(user.userId, input.params.companyId);
  }
}
