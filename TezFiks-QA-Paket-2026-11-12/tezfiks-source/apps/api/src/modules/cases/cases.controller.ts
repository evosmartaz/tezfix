import { Controller } from '@nestjs/common';
import { api, type Locale } from '@tezfiks/shared';
import { Route } from '../../common/http/route.decorator';
import { Input, type RouteInput } from '../../common/http/input.decorator';
import { ClientIp, CurrentAdmin, CurrentUser, ReqLocale } from '../../common/auth/current.decorators';
import type { AdminPrincipal, UserPrincipal } from '../../common/auth/types';
import { CasesService } from './cases.service';
import { AdminCasesService } from './admin-cases.service';

/** Customer: my cases, price dispute and guarantee claim on an assignment. */
@Controller()
export class CasesController {
  constructor(private readonly cases: CasesService) {}

  @Route(api.cases.list)
  list(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.cases.list>) {
    return this.cases.listMine(user.userId, input.query);
  }

  @Route(api.assignments.disputePrice)
  disputePrice(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.assignments.disputePrice>, @ReqLocale() locale: Locale) {
    return this.cases.disputePrice(user.userId, input.params.id, input.body.reason, locale);
  }

  @Route(api.assignments.guaranteeClaim)
  guaranteeClaim(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.assignments.guaranteeClaim>) {
    return this.cases.guaranteeClaim(user.userId, input.params.id, input.body);
  }
}

/** TezFiks admin "Müraciətlər": guarantee claims and price disputes. */
@Controller()
export class AdminCasesController {
  constructor(private readonly cases: AdminCasesService) {}

  @Route(api.admin.cases)
  list(@Input() input: RouteInput<typeof api.admin.cases>) {
    return this.cases.list(input.query);
  }

  @Route(api.admin.case)
  detail(@Input() input: RouteInput<typeof api.admin.case>) {
    return this.cases.detail(input.params.id);
  }

  @Route(api.admin.addCaseNote)
  addNote(@CurrentAdmin() admin: AdminPrincipal, @Input() input: RouteInput<typeof api.admin.addCaseNote>, @ClientIp() ip: string | null) {
    return this.cases.addNote(admin.adminId, input.params.id, input.body.body, ip);
  }

  @Route(api.admin.redispatchCase)
  redispatch(@CurrentAdmin() admin: AdminPrincipal, @Input() input: RouteInput<typeof api.admin.redispatchCase>, @ClientIp() ip: string | null) {
    return this.cases.redispatch(admin.adminId, input.params.id, input.body.note, ip);
  }

  @Route(api.admin.resolveCase)
  resolve(@CurrentAdmin() admin: AdminPrincipal, @Input() input: RouteInput<typeof api.admin.resolveCase>, @ClientIp() ip: string | null) {
    return this.cases.resolve(admin.adminId, input.params.id, input.body, ip);
  }

  @Route(api.admin.rejectCase)
  reject(@CurrentAdmin() admin: AdminPrincipal, @Input() input: RouteInput<typeof api.admin.rejectCase>, @ClientIp() ip: string | null) {
    return this.cases.reject(admin.adminId, input.params.id, input.body.note, ip);
  }
}
