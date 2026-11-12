import { Controller } from '@nestjs/common';
import { api } from '@tezfiks/shared';
import { Route } from '../../common/http/route.decorator';
import { Input, type RouteInput } from '../../common/http/input.decorator';
import { CurrentUser } from '../../common/auth/current.decorators';
import type { UserPrincipal } from '../../common/auth/types';
import { MeService } from './me.service';

@Controller()
export class UsersController {
  constructor(private readonly me: MeService) {}

  @Route(api.me.get)
  get(@CurrentUser() user: UserPrincipal) {
    return this.me.getMe(user.userId);
  }

  @Route(api.me.update)
  update(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.me.update>) {
    return this.me.update(user.userId, input.body);
  }

  @Route(api.me.registerDevice)
  async registerDevice(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.me.registerDevice>) {
    await this.me.registerDevice(user.userId, input.body);
    return { ok: true as const };
  }

  @Route(api.me.deleteAccount)
  async deleteAccount(@CurrentUser() user: UserPrincipal) {
    await this.me.deleteAccount(user.userId);
    return { ok: true as const };
  }
}
