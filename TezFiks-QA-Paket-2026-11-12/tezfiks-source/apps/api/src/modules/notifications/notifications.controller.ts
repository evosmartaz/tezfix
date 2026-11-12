import { Controller } from '@nestjs/common';
import { api } from '@tezfiks/shared';
import { Route } from '../../common/http/route.decorator';
import { Input, type RouteInput } from '../../common/http/input.decorator';
import { CurrentUser } from '../../common/auth/current.decorators';
import type { UserPrincipal } from '../../common/auth/types';
import { NotificationsService } from './notifications.service';

@Controller()
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Route(api.notifications.list)
  async list(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.notifications.list>) {
    return this.notifications.list(user.userId, input.query.cursor, input.query.limit ?? 20);
  }

  @Route(api.notifications.unreadCount)
  async unreadCount(@CurrentUser() user: UserPrincipal) {
    return { count: await this.notifications.unreadCount(user.userId) };
  }

  @Route(api.notifications.markRead)
  async markRead(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.notifications.markRead>) {
    await this.notifications.markRead(user.userId, input.body);
    return { ok: true as const };
  }
}
