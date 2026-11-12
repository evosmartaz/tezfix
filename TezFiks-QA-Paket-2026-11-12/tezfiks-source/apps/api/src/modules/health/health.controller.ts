import { Controller, Inject } from '@nestjs/common';
import { api } from '@tezfiks/shared';
import { Route } from '../../common/http/route.decorator';
import { PrismaService } from '../../infra/prisma.service';
import { RedisService } from '../../infra/redis.service';
import { SettingsService } from '../../common/settings/settings.service';
import { ENV, type Env } from '../../config/env';
import { Clock } from '../../infra/clock';
import { PaymentsService } from '../payments/payments.service';

const VERSION = process.env.APP_VERSION ?? '0.1.0';

@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly settings: SettingsService,
    private readonly clock: Clock,
    private readonly payments: PaymentsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Route(api.health.get)
  async health() {
    const [db, redis] = await Promise.all([
      this.prisma.$queryRawUnsafe('SELECT 1').then(() => true).catch(() => false),
      this.redis.client.ping().then((r) => r === 'PONG').catch(() => false),
    ]);
    return { status: db && redis ? ('ok' as const) : ('degraded' as const), db, redis, version: VERSION, time: this.clock.now().toISOString() };
  }

  @Route(api.health.config)
  async publicConfig() {
    const s = await this.settings.get();
    return {
      demoMode: this.env.DEMO_MODE,
      requestFee: s.requestFee,
      emergencyFeePerSlot: s.emergencyFeePerSlot,
      cancelPenalty: s.cancelPenalty,
      penaltyCompensation: s.penaltyCompensation,
      freeCancelSec: s.freeCancelSec,
      offerTtlSec: s.offerTtlSec,
      maxSlots: s.maxSlots,
      maxPhotos: s.maxPhotos,
      guaranteeDays: s.guaranteeDays,
      scheduledMinLeadMin: s.scheduledMinLeadMin,
      scheduledMaxLeadDays: s.scheduledMaxLeadDays,
      contactUnlockEtaSec: s.contactUnlockEtaSec,
      lowBalanceThreshold: s.lowBalanceThreshold,
      currency: 'AZN',
      supportPhone: this.env.SUPPORT_PHONE ?? null,
      aiEnabled: !!this.env.ANTHROPIC_API_KEY,
      cardPayments: this.payments.cardPaymentsEnabled,
      mapsEnabled: !!this.env.GOOGLE_MAPS_SERVER_KEY,
      otpChannel: this.env.OTP_CHANNEL,
    };
  }
}
