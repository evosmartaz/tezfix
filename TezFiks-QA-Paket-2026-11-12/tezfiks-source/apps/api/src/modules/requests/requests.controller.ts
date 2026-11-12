import { Controller } from '@nestjs/common';
import { api, type Locale } from '@tezfiks/shared';
import { Route } from '../../common/http/route.decorator';
import { Input, type RouteInput } from '../../common/http/input.decorator';
import { CurrentUser, ReqLocale } from '../../common/auth/current.decorators';
import type { UserPrincipal } from '../../common/auth/types';
import { RequestsService } from './requests.service';

/** api.requests.*: classify-photo, create, list, get, cancel. */
@Controller()
export class RequestsController {
  constructor(private readonly requests: RequestsService) {}

  @Route(api.requests.classifyPhoto)
  classifyPhoto(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.requests.classifyPhoto>, @ReqLocale() locale: Locale) {
    return this.requests.classifyPhoto(user.userId, input.body, locale);
  }

  @Route(api.requests.create)
  create(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.requests.create>, @ReqLocale() locale: Locale) {
    return this.requests.create(user.userId, input.body, locale);
  }

  @Route(api.requests.list)
  list(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.requests.list>, @ReqLocale() locale: Locale) {
    return this.requests.list(user.userId, input.query ?? {}, locale);
  }

  @Route(api.requests.get)
  get(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.requests.get>, @ReqLocale() locale: Locale) {
    return this.requests.get(user.userId, input.params.id, locale);
  }

  @Route(api.requests.cancel)
  cancel(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.requests.cancel>, @ReqLocale() locale: Locale) {
    return this.requests.cancel(user.userId, input.params.id, input.body?.reason, locale);
  }
}
