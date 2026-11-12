import { Controller } from '@nestjs/common';
import { api, type Locale } from '@tezfiks/shared';
import { Route } from '../../common/http/route.decorator';
import { Input, type RouteInput } from '../../common/http/input.decorator';
import { ClientIp, CurrentAdmin, ReqLocale } from '../../common/auth/current.decorators';
import type { AdminPrincipal } from '../../common/auth/types';
import { AdminUsersService } from './admin-users.service';
import { AdminDashboardService } from './admin-dashboard.service';
import { AdminRequestsService } from './admin-requests.service';
import { AdminCustomersService } from './admin-customers.service';
import { AdminSettingsService } from './admin-settings.service';
import { AdminAuditService } from './admin-audit.service';

/** Lane B5: TezFiks admin me, dashboard, requests, customers, settings, admins, audit and live map. */
@Controller()
export class AdminController {
  constructor(
    private readonly users: AdminUsersService,
    private readonly dashboardService: AdminDashboardService,
    private readonly requestsService: AdminRequestsService,
    private readonly customersService: AdminCustomersService,
    private readonly settingsService: AdminSettingsService,
    private readonly auditService: AdminAuditService,
  ) {}

  @Route(api.admin.me)
  async me(@CurrentAdmin() admin: AdminPrincipal) {
    return this.users.me(admin.adminId);
  }

  @Route(api.admin.dashboard)
  async dashboard(@ReqLocale() locale: Locale) {
    return this.dashboardService.dashboard(locale);
  }

  // -------------------------------------------------------------- requests

  @Route(api.admin.requests)
  async requests(@Input() input: RouteInput<typeof api.admin.requests>, @ReqLocale() locale: Locale) {
    return this.requestsService.list(input.query, locale);
  }

  @Route(api.admin.request)
  async request(@Input() input: RouteInput<typeof api.admin.request>, @ReqLocale() locale: Locale) {
    return this.requestsService.detail(input.params.id, locale);
  }

  @Route(api.admin.cancelRequest)
  async cancelRequest(
    @CurrentAdmin() admin: AdminPrincipal,
    @Input() input: RouteInput<typeof api.admin.cancelRequest>,
    @ClientIp() ip: string | null,
    @ReqLocale() locale: Locale,
  ) {
    return this.requestsService.cancel(admin.adminId, input.params.id, input.body, ip, locale);
  }

  // ------------------------------------------------------------- customers

  @Route(api.admin.customers)
  async customers(@Input() input: RouteInput<typeof api.admin.customers>) {
    return this.customersService.list(input.query);
  }

  @Route(api.admin.customer)
  async customer(@Input() input: RouteInput<typeof api.admin.customer>, @ReqLocale() locale: Locale) {
    return this.customersService.detail(input.params.id, locale);
  }

  // -------------------------------------------------------------- settings

  @Route(api.admin.settings)
  async settings() {
    return this.settingsService.get();
  }

  @Route(api.admin.updateSettings)
  async updateSettings(
    @CurrentAdmin() admin: AdminPrincipal,
    @Input() input: RouteInput<typeof api.admin.updateSettings>,
    @ClientIp() ip: string | null,
  ) {
    return this.settingsService.update(admin.adminId, input.body, ip);
  }

  // ---------------------------------------------------------------- admins

  @Route(api.admin.admins)
  async admins() {
    return this.users.list();
  }

  @Route(api.admin.createAdmin)
  async createAdmin(
    @CurrentAdmin() admin: AdminPrincipal,
    @Input() input: RouteInput<typeof api.admin.createAdmin>,
    @ClientIp() ip: string | null,
  ) {
    return this.users.create(admin, input.body, ip);
  }

  @Route(api.admin.updateAdmin)
  async updateAdmin(
    @CurrentAdmin() admin: AdminPrincipal,
    @Input() input: RouteInput<typeof api.admin.updateAdmin>,
    @ClientIp() ip: string | null,
  ) {
    return this.users.update(admin, input.params.id, input.body, ip);
  }

  // ------------------------------------------------------------ audit, map

  @Route(api.admin.audit)
  async audit(@Input() input: RouteInput<typeof api.admin.audit>) {
    return this.auditService.list(input.query);
  }

  @Route(api.admin.liveMap)
  async liveMap(@ReqLocale() locale: Locale) {
    return this.dashboardService.liveMap(locale);
  }
}
