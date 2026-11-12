import { Controller } from '@nestjs/common';
import { api, type Locale } from '@tezfiks/shared';
import { Route } from '../../common/http/route.decorator';
import { Input, type RouteInput } from '../../common/http/input.decorator';
import { CurrentUser, ReqLocale } from '../../common/auth/current.decorators';
import type { UserPrincipal } from '../../common/auth/types';
import { CustomerActionsService } from './customer-actions.service';
import { ProviderActionsService } from './provider-actions.service';

/** The contract's CompanyIdParams helper widens its extra keys, so the assignment id is read with a narrow cast. */
function idOf(params: { companyId: string }): string {
  return (params as { companyId: string; id: string }).id;
}

/** Customer actions (api.assignments.*, except disputePrice / guaranteeClaim which live in the cases module). */
@Controller()
export class CustomerAssignmentsController {
  constructor(private readonly customer: CustomerActionsService) {}

  @Route(api.assignments.get)
  get(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.assignments.get>, @ReqLocale() locale: Locale) {
    return this.customer.get(user.userId, input.params.id, locale);
  }

  @Route(api.assignments.cancel)
  cancel(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.assignments.cancel>, @ReqLocale() locale: Locale) {
    return this.customer.cancelLike(user.userId, input.params.id, 'CANCEL', input.body.reason, locale);
  }

  @Route(api.assignments.declineOnArrival)
  declineOnArrival(
    @CurrentUser() user: UserPrincipal,
    @Input() input: RouteInput<typeof api.assignments.declineOnArrival>,
    @ReqLocale() locale: Locale,
  ) {
    return this.customer.cancelLike(user.userId, input.params.id, 'DECLINE_ON_ARRIVAL', input.body.reason, locale);
  }

  @Route(api.assignments.reportNoShow)
  reportNoShow(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.assignments.reportNoShow>, @ReqLocale() locale: Locale) {
    return this.customer.cancelLike(user.userId, input.params.id, 'NO_SHOW', undefined, locale);
  }

  @Route(api.assignments.confirmPrice)
  confirmPrice(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.assignments.confirmPrice>, @ReqLocale() locale: Locale) {
    return this.customer.confirmPrice(user.userId, input.params.id, input.body, locale);
  }

  @Route(api.assignments.tip)
  tip(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.assignments.tip>) {
    return this.customer.tip(user.userId, input.params.id, input.body);
  }

  @Route(api.assignments.rate)
  rate(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.assignments.rate>) {
    return this.customer.rate(user.userId, input.params.id, input.body);
  }
}

/** Pro app: the caller's jobs and provider actions (solo handyman, company worker, or a manager of the company). */
@Controller()
export class ProAssignmentsController {
  constructor(private readonly provider: ProviderActionsService) {}

  @Route(api.pro.assignments)
  list(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.pro.assignments>, @ReqLocale() locale: Locale) {
    return this.provider.listMine(user.userId, input.query, locale);
  }

  @Route(api.pro.assignment)
  get(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.pro.assignment>, @ReqLocale() locale: Locale) {
    return this.provider.get(user.userId, input.params.id, locale);
  }

  @Route(api.pro.enRoute)
  enRoute(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.pro.enRoute>, @ReqLocale() locale: Locale) {
    return this.provider.enRoute(user.userId, input.params.id, input.body.location, locale);
  }

  @Route(api.pro.arrived)
  arrived(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.pro.arrived>, @ReqLocale() locale: Locale) {
    return this.provider.arrived(user.userId, input.params.id, locale);
  }

  @Route(api.pro.enterPrice)
  enterPrice(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.pro.enterPrice>, @ReqLocale() locale: Locale) {
    return this.provider.enterPrice(user.userId, input.params.id, input.body, locale, null);
  }

  @Route(api.pro.cancel)
  cancel(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.pro.cancel>, @ReqLocale() locale: Locale) {
    return this.provider.cancel(user.userId, input.params.id, input.body.reason, locale, null);
  }

  @Route(api.pro.rateCustomer)
  rateCustomer(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.pro.rateCustomer>) {
    return this.provider.rateCustomer(user.userId, input.params.id, input.body);
  }
}

/** Company manager: company jobs, manager price entry, reassign, cancel. */
@Controller()
export class CompanyAssignmentsController {
  constructor(private readonly provider: ProviderActionsService) {}

  @Route(api.company.assignments)
  list(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.company.assignments>, @ReqLocale() locale: Locale) {
    return this.provider.listCompany(user.userId, input.params.companyId, input.query, locale);
  }

  @Route(api.company.assignment)
  get(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.company.assignment>, @ReqLocale() locale: Locale) {
    return this.provider.getCompany(user.userId, input.params.companyId, idOf(input.params), locale);
  }

  @Route(api.company.enterPrice)
  enterPrice(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.company.enterPrice>, @ReqLocale() locale: Locale) {
    const companyId = input.params.companyId;
    return this.provider.enterPrice(user.userId, idOf(input.params), input.body, locale, { companyId });
  }

  @Route(api.company.reassign)
  reassign(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.company.reassign>, @ReqLocale() locale: Locale) {
    return this.provider.reassign(user.userId, input.params.companyId, idOf(input.params), input.body.workerId, locale);
  }

  @Route(api.company.cancelAssignment)
  cancel(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.company.cancelAssignment>, @ReqLocale() locale: Locale) {
    const companyId = input.params.companyId;
    return this.provider.cancel(user.userId, idOf(input.params), input.body.reason, locale, { companyId });
  }
}
