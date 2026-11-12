import { Controller } from '@nestjs/common';
import { api } from '@tezfiks/shared';
import { Route } from '../../common/http/route.decorator';
import { Input, type RouteInput } from '../../common/http/input.decorator';
import { ClientIp, CurrentUser } from '../../common/auth/current.decorators';
import type { UserPrincipal } from '../../common/auth/types';
import { KycService } from './kyc.service';

/** KYC submission and status (pro app / company manager). */
@Controller()
export class KycController {
  constructor(private readonly kyc: KycService) {}

  @Route(api.kyc.submit)
  async submit(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.kyc.submit>, @ClientIp() ip: string | null) {
    return this.kyc.submit(user.userId, input.body, ip);
  }

  @Route(api.kyc.status)
  async status(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.kyc.status>) {
    return this.kyc.status(user.userId, input.query.companyId);
  }
}
