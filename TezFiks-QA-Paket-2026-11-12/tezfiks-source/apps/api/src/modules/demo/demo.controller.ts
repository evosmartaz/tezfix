import { Controller } from '@nestjs/common';
import { api, type Locale } from '@tezfiks/shared';
import { Route } from '../../common/http/route.decorator';
import { Input, type RouteInput } from '../../common/http/input.decorator';
import { ClientIp, CurrentAdmin, ReqLocale } from '../../common/auth/current.decorators';
import type { AdminPrincipal } from '../../common/auth/types';
import { AuditService } from '../../common/audit/audit.service';
import { DemoConfigService } from './demo-config.service';
import { DemoBotsService } from './demo-bots.service';
import { DemoRequestsService } from './demo-requests.service';

/** Admin "Demo" page (DEMO_MODE only): simulator state and config, bot spawn / clear, test requests. */
@Controller()
export class DemoController {
  constructor(
    private readonly config: DemoConfigService,
    private readonly bots: DemoBotsService,
    private readonly requests: DemoRequestsService,
    private readonly audit: AuditService,
  ) {}

  @Route(api.admin.demoState)
  async state(@ReqLocale() locale: Locale) {
    this.config.assertEnabled();
    return this.bots.state(locale);
  }

  @Route(api.admin.demoSpawnBots)
  async spawn(
    @CurrentAdmin() admin: AdminPrincipal,
    @Input() input: RouteInput<typeof api.admin.demoSpawnBots>,
    @ClientIp() ip: string | null,
    @ReqLocale() locale: Locale,
  ) {
    this.config.assertEnabled();
    await this.bots.spawn(admin.adminId, input.body, ip);
    return this.bots.state(locale);
  }

  @Route(api.admin.demoClearBots)
  async clear(@CurrentAdmin() admin: AdminPrincipal, @ClientIp() ip: string | null, @ReqLocale() locale: Locale) {
    this.config.assertEnabled();
    await this.bots.clear(admin.adminId, ip);
    return this.bots.state(locale);
  }

  @Route(api.admin.demoConfig)
  async updateConfig(
    @CurrentAdmin() admin: AdminPrincipal,
    @Input() input: RouteInput<typeof api.admin.demoConfig>,
    @ClientIp() ip: string | null,
    @ReqLocale() locale: Locale,
  ) {
    this.config.assertEnabled();
    const { before, after } = await this.config.update(input.body ?? {}, admin.adminId);
    await this.audit.log({ actorType: 'ADMIN', actorId: admin.adminId, action: 'demo.config', entityType: 'PlatformSetting', entityId: 'demo.config', before, after, ip });
    return this.bots.state(locale);
  }

  @Route(api.admin.demoCreateRequest)
  async createRequest(
    @CurrentAdmin() admin: AdminPrincipal,
    @Input() input: RouteInput<typeof api.admin.demoCreateRequest>,
    @ClientIp() ip: string | null,
  ) {
    this.config.assertEnabled();
    return this.requests.create(admin.adminId, input.body, ip);
  }
}
