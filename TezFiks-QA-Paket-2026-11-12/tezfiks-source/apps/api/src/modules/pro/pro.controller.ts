import { Controller } from '@nestjs/common';
import { api, type Locale } from '@tezfiks/shared';
import { Route } from '../../common/http/route.decorator';
import { Input, type RouteInput } from '../../common/http/input.decorator';
import { CurrentUser, ReqLocale } from '../../common/auth/current.decorators';
import type { UserPrincipal } from '../../common/auth/types';
import { ProService } from './pro.service';
import { ProviderViewsService } from './provider-views.service';

/** Pro app: profile, onboarding, online switch, location pings, today's stats. */
@Controller()
export class ProController {
  constructor(
    private readonly pro: ProService,
    private readonly views: ProviderViewsService,
  ) {}

  @Route(api.pro.profile)
  async profile(@CurrentUser() user: UserPrincipal, @ReqLocale() locale: Locale) {
    return this.views.profileResponse(user.userId, locale);
  }

  @Route(api.pro.onboardSolo)
  async onboardSolo(
    @CurrentUser() user: UserPrincipal,
    @Input() input: RouteInput<typeof api.pro.onboardSolo>,
    @ReqLocale() locale: Locale,
  ) {
    return this.pro.onboardSolo(user.userId, input.body, locale);
  }

  @Route(api.pro.onboardCompany)
  async onboardCompany(
    @CurrentUser() user: UserPrincipal,
    @Input() input: RouteInput<typeof api.pro.onboardCompany>,
    @ReqLocale() locale: Locale,
  ) {
    return this.pro.onboardCompany(user.userId, input.body, locale);
  }

  @Route(api.pro.updateProfile)
  async updateProfile(
    @CurrentUser() user: UserPrincipal,
    @Input() input: RouteInput<typeof api.pro.updateProfile>,
    @ReqLocale() locale: Locale,
  ) {
    return this.pro.updateProfile(user.userId, input.body, locale);
  }

  @Route(api.pro.setOnline)
  async setOnline(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.pro.setOnline>) {
    return this.pro.setOnline(user.userId, input.body);
  }

  @Route(api.pro.location)
  async location(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.pro.location>) {
    return this.pro.location(user.userId, input.body);
  }

  @Route(api.pro.statsToday)
  async statsToday(@CurrentUser() user: UserPrincipal) {
    return this.pro.statsToday(user.userId);
  }
}
