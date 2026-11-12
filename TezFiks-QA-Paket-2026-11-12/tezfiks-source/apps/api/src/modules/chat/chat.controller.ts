import { Controller } from '@nestjs/common';
import { api } from '@tezfiks/shared';
import { Route } from '../../common/http/route.decorator';
import { Input, type RouteInput } from '../../common/http/input.decorator';
import { CurrentUser } from '../../common/auth/current.decorators';
import type { UserPrincipal } from '../../common/auth/types';
import { ChatService } from './chat.service';

/** api.chat.*: messages of one assignment (customer, assigned handyman, managers of the company). */
@Controller()
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Route(api.chat.list)
  list(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.chat.list>) {
    return this.chat.list(user.userId, input.params.id, input.query);
  }

  @Route(api.chat.send)
  send(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.chat.send>) {
    return this.chat.send(user.userId, input.params.id, input.body.body);
  }

  @Route(api.chat.markRead)
  markRead(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.chat.markRead>) {
    return this.chat.markRead(user.userId, input.params.id);
  }
}
