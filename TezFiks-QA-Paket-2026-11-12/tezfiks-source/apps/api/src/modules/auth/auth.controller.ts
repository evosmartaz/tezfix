import { Controller } from '@nestjs/common';
import { api, type Locale } from '@tezfiks/shared';
import { Route } from '../../common/http/route.decorator';
import { Input, type RouteInput } from '../../common/http/input.decorator';
import { ClientIp, CurrentPrincipal, ReqLocale, UserAgent } from '../../common/auth/current.decorators';
import type { Principal } from '../../common/auth/types';
import { ApiException } from '../../common/http/api-exception';
import { SessionsService } from '../../common/auth/sessions.service';
import { TokenService } from '../../common/auth/token.service';
import { PrismaService } from '../../infra/prisma.service';
import { OtpService } from './otp.service';
import { AdminAuthService } from './admin-auth.service';

@Controller()
export class AuthController {
  constructor(
    private readonly otp: OtpService,
    private readonly adminAuth: AdminAuthService,
    private readonly sessions: SessionsService,
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  @Route(api.auth.otpRequest)
  otpRequest(@Input() input: RouteInput<typeof api.auth.otpRequest>, @ReqLocale() locale: Locale, @ClientIp() ip: string | null) {
    return this.otp.request({ phone: input.body.phone, app: input.body.app, locale: input.body.locale ?? locale }, { ip });
  }

  @Route(api.auth.otpVerify)
  otpVerify(
    @Input() input: RouteInput<typeof api.auth.otpVerify>,
    @ClientIp() ip: string | null,
    @UserAgent() userAgent: string | null,
  ) {
    return this.otp.verify(input.body, { ip, userAgent });
  }

  @Route(api.auth.refresh)
  refresh(@Input() input: RouteInput<typeof api.auth.refresh>, @ClientIp() ip: string | null) {
    return this.sessions.rotate(input.body.refreshToken, { deviceId: input.body.deviceId ?? null, ip });
  }

  @Route(api.auth.logout)
  async logout(@CurrentPrincipal() principal: Principal | undefined, @Input() input: RouteInput<typeof api.auth.logout>) {
    if (!principal) throw new ApiException('UNAUTHORIZED');
    await this.sessions.revoke(principal.sessionId, 'LOGOUT');
    await this.clearDevicePush(principal.sessionId);
    if (input.body.refreshToken) {
      const other = await this.prisma.session.findUnique({
        where: { refreshTokenHash: this.tokens.hash(input.body.refreshToken) },
        select: { id: true, userId: true, adminId: true },
      });
      const mine = other && (principal.kind === 'user' ? other.userId === principal.userId : other.adminId === principal.adminId);
      if (other && mine && other.id !== principal.sessionId) {
        await this.sessions.revoke(other.id, 'LOGOUT');
        await this.clearDevicePush(other.id);
      }
    }
    return { ok: true as const };
  }

  /** A logged-out phone must stop receiving the user's pushes: drop the token of that session's device and app. */
  private async clearDevicePush(sessionId: string) {
    const s = await this.prisma.session.findUnique({ where: { id: sessionId }, select: { userId: true, deviceId: true, app: true } });
    if (!s?.userId || !s.deviceId) return;
    await this.prisma.device.updateMany({
      where: { userId: s.userId, deviceId: s.deviceId, app: s.app },
      data: { pushToken: null, pushProvider: null },
    });
  }

  @Route(api.auth.adminLogin)
  adminLogin(
    @Input() input: RouteInput<typeof api.auth.adminLogin>,
    @ClientIp() ip: string | null,
    @UserAgent() userAgent: string | null,
  ) {
    return this.adminAuth.login(input.body, { ip, userAgent });
  }

  @Route(api.auth.realtimeTicket)
  async realtimeTicket(@CurrentPrincipal() principal: Principal | undefined) {
    if (!principal) throw new ApiException('UNAUTHORIZED');
    const t = await this.tokens.issueRealtimeTicket(principal);
    return { ticket: t.ticket, expiresAt: t.expiresAt.toISOString() };
  }
}
