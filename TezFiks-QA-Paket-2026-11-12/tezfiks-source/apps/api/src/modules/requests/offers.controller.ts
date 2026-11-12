import { Controller } from '@nestjs/common';
import { api, type Locale } from '@tezfiks/shared';
import { Route } from '../../common/http/route.decorator';
import { Input, type RouteInput } from '../../common/http/input.decorator';
import { CurrentUser, ReqLocale } from '../../common/auth/current.decorators';
import type { UserPrincipal } from '../../common/auth/types';
import { OffersService } from './offers.service';

/** The contract's CompanyIdParams helper widens its extra keys, so offerId is read with a narrow cast. */
function offerIdOf(params: { companyId: string }): string {
  return (params as { companyId: string; offerId: string }).offerId;
}

/** Offers for solo handymen (api.pro.offers...) and company managers (api.company.offers...). */
@Controller()
export class OffersController {
  constructor(private readonly offers: OffersService) {}

  @Route(api.pro.offers)
  proOffers(@CurrentUser() user: UserPrincipal, @ReqLocale() locale: Locale) {
    return this.offers.proOffers(user.userId, locale, 'current');
  }

  @Route(api.pro.scheduledOffers)
  scheduledOffers(@CurrentUser() user: UserPrincipal, @ReqLocale() locale: Locale) {
    return this.offers.proOffers(user.userId, locale, 'scheduled');
  }

  @Route(api.pro.acceptOffer)
  acceptOffer(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.pro.acceptOffer>, @ReqLocale() locale: Locale) {
    return this.offers.acceptSolo(user.userId, input.params.id, locale);
  }

  @Route(api.pro.declineOffer)
  declineOffer(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.pro.declineOffer>) {
    return this.offers.declineSolo(user.userId, input.params.id);
  }

  @Route(api.pro.seenOffer)
  seenOffer(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.pro.seenOffer>) {
    return this.offers.seen(user.userId, input.params.id);
  }

  @Route(api.company.offers)
  companyOffers(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.company.offers>, @ReqLocale() locale: Locale) {
    return this.offers.companyOffers(user.userId, input.params.companyId, locale);
  }

  @Route(api.company.acceptOffer)
  companyAccept(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.company.acceptOffer>, @ReqLocale() locale: Locale) {
    return this.offers.acceptCompany(user.userId, input.params.companyId, offerIdOf(input.params), input.body.workerIds, locale);
  }

  @Route(api.company.declineOffer)
  companyDecline(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.company.declineOffer>) {
    return this.offers.declineCompany(user.userId, input.params.companyId, offerIdOf(input.params));
  }
}
