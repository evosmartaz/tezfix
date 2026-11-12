import { Controller } from '@nestjs/common';
import { api, type Locale } from '@tezfiks/shared';
import { Route } from '../../common/http/route.decorator';
import { Input, type RouteInput } from '../../common/http/input.decorator';
import { CurrentUser, ReqLocale } from '../../common/auth/current.decorators';
import type { UserPrincipal } from '../../common/auth/types';
import { RateLimiter } from '../../infra/rate-limiter';
import { GeoService } from './geo.service';

/** 60 geo calls per user per minute (spec §15). */
export const GEO_RATE_LIMIT = 60;
export const GEO_RATE_WINDOW_SEC = 60;

@Controller()
export class GeoController {
  constructor(
    private readonly geo: GeoService,
    private readonly limiter: RateLimiter,
  ) {}

  private limit(user: UserPrincipal): Promise<void> {
    return this.limiter.enforce(`geo:${user.userId}`, GEO_RATE_LIMIT, GEO_RATE_WINDOW_SEC);
  }

  @Route(api.geo.reverse)
  async reverse(@Input() input: RouteInput<typeof api.geo.reverse>, @CurrentUser() user: UserPrincipal, @ReqLocale() locale: Locale) {
    await this.limit(user);
    return this.geo.reverse(input.query.lat, input.query.lng, locale);
  }

  @Route(api.geo.autocomplete)
  async autocomplete(
    @Input() input: RouteInput<typeof api.geo.autocomplete>,
    @CurrentUser() user: UserPrincipal,
    @ReqLocale() locale: Locale,
  ) {
    await this.limit(user);
    const { q, sessionToken, lat, lng } = input.query;
    const bias = lat !== undefined && lng !== undefined ? { lat, lng } : null;
    return this.geo.autocomplete(q, sessionToken, bias, locale);
  }

  @Route(api.geo.place)
  async place(@Input() input: RouteInput<typeof api.geo.place>, @CurrentUser() user: UserPrincipal, @ReqLocale() locale: Locale) {
    await this.limit(user);
    return this.geo.place(input.params.placeId, input.query?.sessionToken ?? null, locale);
  }
}
