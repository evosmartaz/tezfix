import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { maskPhone, normalizeAzMobile, type Locale } from '@tezfiks/shared';
import { ENV, type Env } from '../../config/env';
import { PrismaService } from '../../infra/prisma.service';
import { RedisService } from '../../infra/redis.service';
import { Clock } from '../../infra/clock';
import { newId } from '../../infra/ids';
import { ApiException } from '../../common/http/api-exception';
import { SessionsService } from '../../common/auth/sessions.service';
import { I18nService } from '../../common/i18n/i18n.service';
import type { IssuedTokens } from '../../common/auth/types';
import { MeService } from '../users/me.service';
import { OTP_CHANNEL, type OtpChannel } from './otp/otp-channel';

export const OTP_TTL_MS = 5 * 60_000;
export const OTP_COOLDOWN_SEC = 60;
export const OTP_MAX_PER_PHONE_PER_HOUR = 5;
export const OTP_MAX_PER_IP_PER_HOUR = 20;
export const OTP_MAX_ATTEMPTS = 5;
const HOUR_MS = 3_600_000;

type LoginApp = 'CUSTOMER' | 'PRO' | 'PANEL';

/**
 * Atomic OTP limits keyed by Clock time (so tests can move time): 60 s cooldown per phone, sliding one-hour windows
 * per phone and per IP. Returns {0,0} when allowed (and records the send), {1,ms} cooldown, {2,ms} phone limit, {3,ms} IP limit.
 */
const LIMIT_SCRIPT = `
local now = tonumber(ARGV[1])
local cd = tonumber(ARGV[2])
local win = tonumber(ARGV[3])
local checkPhone = ARGV[7] == '1'
if checkPhone then
  local last = redis.call('GET', KEYS[1])
  if last then
    local diff = now - tonumber(last)
    if diff < cd then return {1, cd - diff} end
  end
  redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now - win)
  if redis.call('ZCARD', KEYS[2]) >= tonumber(ARGV[4]) then
    local oldest = redis.call('ZRANGE', KEYS[2], 0, 0, 'WITHSCORES')
    return {2, tonumber(oldest[2]) + win - now}
  end
end
redis.call('ZREMRANGEBYSCORE', KEYS[3], '-inf', now - win)
if redis.call('ZCARD', KEYS[3]) >= tonumber(ARGV[5]) then
  local oldest = redis.call('ZRANGE', KEYS[3], 0, 0, 'WITHSCORES')
  return {3, tonumber(oldest[2]) + win - now}
end
if checkPhone then
  redis.call('SET', KEYS[1], ARGV[1], 'PX', cd)
  redis.call('ZADD', KEYS[2], now, ARGV[6])
  redis.call('PEXPIRE', KEYS[2], win)
end
redis.call('ZADD', KEYS[3], now, ARGV[6])
redis.call('PEXPIRE', KEYS[3], win)
return {0, 0}
`;

export interface OtpRequestResult {
  challengeId: string;
  phone: string;
  expiresAt: string;
  resendAfterSec: number;
  channel: string;
  devCode?: string;
}

/** WhatsApp/console/webhook login codes: request (limits, delivery) and verify (attempts, user creation, session). */
@Injectable()
export class OtpService {
  private readonly log = new Logger('OTP');
  private readonly bypassPhones: Set<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly clock: Clock,
    private readonly sessions: SessionsService,
    private readonly i18n: I18nService,
    private readonly me: MeService,
    @Inject(OTP_CHANNEL) private readonly channel: OtpChannel,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.bypassPhones = new Set(env.OTP_BYPASS_PHONES.map((p) => normalizeAzMobile(p) ?? p));
  }

  private codeHash(challengeId: string, code: string): string {
    return createHmac('sha256', this.env.JWT_SECRET).update(`${challengeId}:${code}`).digest('hex');
  }

  private isBypass(phone: string): boolean {
    return !!this.env.OTP_BYPASS_CODE && this.bypassPhones.has(phone);
  }

  private keys(phone: string, ip: string | null): [string, string, string] {
    return [this.redis.key('otp', 'cd', phone), this.redis.key('otp', 'ph', phone), this.redis.key('otp', 'ip', ip ?? 'unknown')];
  }

  async request(input: { phone: string; app: LoginApp; locale: Locale }, meta: { ip: string | null }): Promise<OtpRequestResult> {
    const phone = normalizeAzMobile(input.phone);
    if (!phone) throw new ApiException('PHONE_INVALID');
    const bypass = this.isBypass(phone);
    const challengeId = newId();
    const nowMs = this.clock.nowMs();
    const keys = this.keys(phone, meta.ip);
    const [verdict, waitMs] = (await this.redis.client.eval(
      LIMIT_SCRIPT,
      3,
      ...keys,
      String(nowMs),
      String(OTP_COOLDOWN_SEC * 1000),
      String(HOUR_MS),
      String(OTP_MAX_PER_PHONE_PER_HOUR),
      String(OTP_MAX_PER_IP_PER_HOUR),
      challengeId,
      bypass ? '0' : '1',
    )) as [number, number];
    const retryAfterSec = Math.max(1, Math.ceil(Number(waitMs) / 1000));
    if (verdict === 1) throw new ApiException('OTP_COOLDOWN', { retryAfterSec });
    if (verdict === 2 || verdict === 3) throw new ApiException('RATE_LIMITED', { retryAfterSec, scope: verdict === 2 ? 'phone' : 'ip' });

    const code = bypass ? this.env.OTP_BYPASS_CODE! : String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = new Date(nowMs + OTP_TTL_MS);
    const channelName = bypass ? 'bypass' : this.channel.name;
    await this.prisma.otpChallenge.create({
      data: {
        id: challengeId,
        phone,
        codeHash: this.codeHash(challengeId, code),
        app: input.app,
        locale: input.locale,
        channel: channelName,
        expiresAt,
        ip: meta.ip,
        createdAt: this.clock.now(),
      },
    });

    if (!bypass) {
      try {
        await this.channel.send({
          challengeId,
          phone,
          code,
          locale: input.locale,
          expiresAt,
          app: input.app,
          text: this.i18n.t(input.locale, 'server.core.otp.message', { code, minutes: OTP_TTL_MS / 60_000 }),
        });
      } catch (err) {
        this.log.error(`delivery to ${maskPhone(phone)} over ${this.channel.name} failed: ${(err as Error).message}`);
        await this.prisma.otpChallenge.delete({ where: { id: challengeId } }).catch(() => undefined);
        await this.releaseLimits(keys, challengeId, nowMs);
        throw new ApiException('INTERNAL', { reason: 'OTP_DELIVERY_FAILED' });
      }
    }

    return {
      challengeId,
      phone,
      expiresAt: expiresAt.toISOString(),
      resendAfterSec: OTP_COOLDOWN_SEC,
      channel: this.channel.name,
      ...(this.env.OTP_DEV_ECHO ? { devCode: code } : {}),
    };
  }

  /** A failed delivery does not count against the user's limits. */
  private async releaseLimits(keys: [string, string, string], challengeId: string, nowMs: number): Promise<void> {
    const [cd, ph, ip] = keys;
    try {
      if ((await this.redis.client.get(cd)) === String(nowMs)) await this.redis.client.del(cd);
      await this.redis.client.zrem(ph, challengeId);
      await this.redis.client.zrem(ip, challengeId);
    } catch {
      // best effort
    }
  }

  async verify(
    input: { challengeId: string; code: string; deviceId: string; app: LoginApp },
    meta: { ip: string | null; userAgent: string | null },
  ): Promise<{ tokens: IssuedTokens; me: Awaited<ReturnType<MeService['getMe']>>; isNewUser: boolean }> {
    const ch = await this.prisma.otpChallenge.findUnique({ where: { id: input.challengeId } });
    if (!ch || ch.consumedAt || ch.app !== input.app) throw new ApiException('OTP_INVALID');
    if (ch.expiresAt <= this.clock.now()) throw new ApiException('OTP_EXPIRED');
    if (ch.attempts >= OTP_MAX_ATTEMPTS) throw new ApiException('OTP_TOO_MANY_ATTEMPTS');

    const expected = Buffer.from(ch.codeHash, 'hex');
    const actual = Buffer.from(this.codeHash(ch.id, input.code), 'hex');
    const ok = expected.length === actual.length && timingSafeEqual(expected, actual);
    if (!ok) {
      const rows = await this.prisma.$queryRawUnsafe<Array<{ attempts: number }>>(
        `UPDATE "otp_challenges" SET "attempts" = "attempts" + 1
         WHERE "id" = $1::uuid AND "consumedAt" IS NULL AND "attempts" < $2
         RETURNING "attempts"`,
        ch.id,
        OTP_MAX_ATTEMPTS,
      );
      if (!rows.length) throw new ApiException('OTP_TOO_MANY_ATTEMPTS');
      throw new ApiException('OTP_INVALID', { attemptsLeft: Math.max(0, OTP_MAX_ATTEMPTS - Number(rows[0]!.attempts)) });
    }

    const consumed = await this.prisma.otpChallenge.updateMany({
      where: { id: ch.id, consumedAt: null, attempts: { lt: OTP_MAX_ATTEMPTS } },
      data: { consumedAt: this.clock.now() },
    });
    if (!consumed.count) throw new ApiException('OTP_INVALID');

    let user = await this.prisma.user.findUnique({ where: { phone: ch.phone } });
    let isNewUser = false;
    if (!user) {
      try {
        user = await this.prisma.user.create({ data: { phone: ch.phone, locale: ch.locale, createdAt: this.clock.now() } });
        isNewUser = true;
      } catch (err) {
        if ((err as { code?: string }).code !== 'P2002') throw err;
        user = await this.prisma.user.findUniqueOrThrow({ where: { phone: ch.phone } });
      }
    }
    if (user.status === 'BLOCKED') throw new ApiException('USER_BLOCKED');
    if (user.status !== 'ACTIVE') throw new ApiException('UNAUTHORIZED');

    const tokens = await this.sessions.createUserSession(user.id, input.app, {
      deviceId: input.deviceId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return { tokens, me: await this.me.getMe(user.id), isNewUser };
  }
}
