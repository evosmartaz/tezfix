import { Controller } from '@nestjs/common';
import { api, type Locale } from '@tezfiks/shared';
import { Route } from '../../common/http/route.decorator';
import { Input, type RouteInput } from '../../common/http/input.decorator';
import { ClientIp, CurrentUser, ReqLocale } from '../../common/auth/current.decorators';
import type { UserPrincipal } from '../../common/auth/types';
import { InvitesService } from './invites.service';

/** Invite links: public preview, accept (signed-in user). */
@Controller()
export class InvitesController {
  constructor(private readonly invites: InvitesService) {}

  @Route(api.invites.preview)
  async preview(@Input() input: RouteInput<typeof api.invites.preview>, @ClientIp() ip: string | null) {
    return this.invites.preview(input.params.token, ip);
  }

  @Route(api.invites.accept)
  async accept(
    @CurrentUser() user: UserPrincipal,
    @Input() input: RouteInput<typeof api.invites.accept>,
    @ReqLocale() locale: Locale,
  ) {
    return this.invites.accept(user.userId, input.params.token, input.body, locale);
  }
}
