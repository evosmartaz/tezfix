import { Controller } from '@nestjs/common';
import { api, type Locale } from '@tezfiks/shared';
import { Route } from '../../common/http/route.decorator';
import { Input, type RouteInput } from '../../common/http/input.decorator';
import { ClientIp, CurrentAdmin, CurrentUser, ReqLocale } from '../../common/auth/current.decorators';
import type { AdminPrincipal, UserPrincipal } from '../../common/auth/types';
import { ProjectsService } from './projects.service';
import { ProviderProjectsService } from './provider-projects.service';
import { ProjectAdminService } from './project-admin.service';

/** api.projects.*: the customer side of B2B projects. */
@Controller()
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Route(api.projects.create)
  create(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.projects.create>, @ReqLocale() locale: Locale) {
    return this.projects.create(user.userId, input.body, locale);
  }

  @Route(api.projects.list)
  list(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.projects.list>, @ReqLocale() locale: Locale) {
    return this.projects.list(user.userId, input.query ?? {}, locale);
  }

  @Route(api.projects.get)
  get(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.projects.get>, @ReqLocale() locale: Locale) {
    return this.projects.get(user.userId, input.params.id, locale);
  }

  @Route(api.projects.acceptQuote)
  acceptQuote(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.projects.acceptQuote>, @ReqLocale() locale: Locale) {
    return this.projects.acceptQuote(user.userId, input.params.id, input.params.quoteId, locale);
  }

  @Route(api.projects.cancel)
  cancel(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.projects.cancel>, @ReqLocale() locale: Locale) {
    return this.projects.cancel(user.userId, input.params.id, locale);
  }

  @Route(api.projects.rate)
  rate(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.projects.rate>) {
    return this.projects.rate(user.userId, input.params.id, input.body);
  }

  @Route(api.projects.guaranteeClaim)
  guaranteeClaim(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.projects.guaranteeClaim>) {
    return this.projects.guaranteeClaim(user.userId, input.params.id, input.body);
  }
}

/** api.providerProjects.*: solo handymen, or company managers acting with companyId. */
@Controller()
export class ProviderProjectsController {
  constructor(private readonly provider: ProviderProjectsService) {}

  @Route(api.providerProjects.open)
  open(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.providerProjects.open>, @ReqLocale() locale: Locale) {
    return this.provider.open(user.userId, input.query?.companyId, locale);
  }

  @Route(api.providerProjects.mine)
  mine(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.providerProjects.mine>, @ReqLocale() locale: Locale) {
    return this.provider.mine(user.userId, input.query ?? {}, locale);
  }

  @Route(api.providerProjects.get)
  get(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.providerProjects.get>, @ReqLocale() locale: Locale) {
    return this.provider.get(user.userId, input.params.id, input.query?.companyId, locale);
  }

  @Route(api.providerProjects.submitQuote)
  submitQuote(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.providerProjects.submitQuote>) {
    return this.provider.submitQuote(user.userId, input.params.id, input.body);
  }

  @Route(api.providerProjects.withdrawQuote)
  withdrawQuote(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.providerProjects.withdrawQuote>) {
    return this.provider.withdrawQuote(user.userId, input.params.id);
  }

  @Route(api.providerProjects.addReport)
  addReport(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.providerProjects.addReport>) {
    return this.provider.addReport(user.userId, input.params.id, input.body);
  }

  @Route(api.providerProjects.complete)
  complete(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.providerProjects.complete>) {
    return this.provider.complete(user.userId, input.params.id, input.body ?? {});
  }
}

/** api.admin.{projects, project, invoices, markInvoicePaid}. */
@Controller()
export class AdminProjectsController {
  constructor(private readonly admin: ProjectAdminService) {}

  @Route(api.admin.projects)
  projects(@CurrentAdmin() _admin: AdminPrincipal, @Input() input: RouteInput<typeof api.admin.projects>, @ReqLocale() locale: Locale) {
    return this.admin.projects(input.query ?? {}, locale);
  }

  @Route(api.admin.project)
  project(@CurrentAdmin() _admin: AdminPrincipal, @Input() input: RouteInput<typeof api.admin.project>, @ReqLocale() locale: Locale) {
    return this.admin.project(input.params.id, locale);
  }

  @Route(api.admin.invoices)
  invoices(@CurrentAdmin() _admin: AdminPrincipal, @Input() input: RouteInput<typeof api.admin.invoices>) {
    return this.admin.invoices(input.query ?? {});
  }

  @Route(api.admin.markInvoicePaid)
  markInvoicePaid(@CurrentAdmin() admin: AdminPrincipal, @Input() input: RouteInput<typeof api.admin.markInvoicePaid>, @ClientIp() ip: string | null) {
    return this.admin.markInvoicePaid(admin.adminId, input.params.id, ip);
  }
}
