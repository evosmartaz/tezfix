import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AppKind } from '@tezfiks/shared';
import { ENV, type Env } from '../../../config/env';
import { PrismaService } from '../../../infra/prisma.service';
import { isExpoToken } from './expo.sender';
import { PUSH_SENDERS, type PushDelivery, type PushMessage, type PushSendResult, type PushSenderName, type PushSenders } from './push.types';

export interface PushTargetFilter {
  /** Only devices of this app (CUSTOMER / PRO / PANEL). */
  app?: AppKind;
}

export interface PushOutcome {
  attempted: number;
  delivered: number;
  removedTokens: number;
}

/**
 * Sends pushes to users' registered devices. Never throws into callers: every failure is logged and swallowed.
 * Sender choice: PUSH_PROVIDER=log sends everything to the in-memory log sender; otherwise each device goes to the
 * sender of its pushProvider (EXPO -> expo, FCM -> fcm; unknown provider is inferred from the token format).
 * Tokens the provider reports as unregistered are removed from the device rows.
 */
@Injectable()
export class PushService {
  private readonly log = new Logger('PushService');

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
    @Inject(PUSH_SENDERS) private readonly senders: PushSenders,
  ) {}

  /** Pushes one message to every device (with a push token) of the given users. */
  async sendToUsers(userIds: string[], message: PushMessage, filter: PushTargetFilter = {}): Promise<PushOutcome> {
    try {
      if (!userIds.length) return { attempted: 0, delivered: 0, removedTokens: 0 };
      const devices = await this.prisma.device.findMany({
        where: { userId: { in: userIds }, pushToken: { not: null }, ...(filter.app ? { app: filter.app } : {}) },
        select: { id: true, userId: true, app: true, pushToken: true, pushProvider: true },
      });
      const deliveries: PushDelivery[] = devices.map((d) => ({
        token: d.pushToken!,
        provider: d.pushProvider,
        deviceRowId: d.id,
        userId: d.userId,
        app: d.app,
      }));
      return await this.deliver(deliveries, message);
    } catch (err) {
      this.log.error(`push to ${userIds.length} user(s) failed: ${(err as Error).message}`);
      return { attempted: 0, delivered: 0, removedTokens: 0 };
    }
  }

  /** Low-level: sends to explicit deliveries (grouped by sender), then cleans unregistered tokens. Never throws. */
  async deliver(deliveries: PushDelivery[], message: PushMessage): Promise<PushOutcome> {
    const outcome: PushOutcome = { attempted: deliveries.length, delivered: 0, removedTokens: 0 };
    if (!deliveries.length) return outcome;
    const groups = new Map<PushSenderName, PushDelivery[]>();
    for (const d of deliveries) {
      const name = this.senderFor(d);
      const list = groups.get(name) ?? [];
      list.push(d);
      groups.set(name, list);
    }
    const dead = new Set<string>();
    for (const [name, list] of groups) {
      let results: PushSendResult[] = [];
      try {
        results = await this.senders[name].send(list, message);
      } catch (err) {
        this.log.warn(`${name} sender threw: ${(err as Error).message}`);
        continue;
      }
      for (const r of results) {
        if (r.ok) outcome.delivered += 1;
        if (r.unregistered) dead.add(r.token);
        else if (!r.ok) this.log.warn(`${name} push to …${r.token.slice(-6)} failed: ${r.error ?? 'unknown'}`);
      }
    }
    if (dead.size) {
      try {
        const res = await this.prisma.device.updateMany({
          where: { pushToken: { in: [...dead] } },
          data: { pushToken: null, pushProvider: null },
        });
        outcome.removedTokens = res.count;
      } catch (err) {
        this.log.warn(`removing unregistered tokens failed: ${(err as Error).message}`);
      }
    }
    return outcome;
  }

  private senderFor(d: PushDelivery): PushSenderName {
    if (this.env.PUSH_PROVIDER === 'log') return 'log';
    if (d.provider === 'EXPO') return 'expo';
    if (d.provider === 'FCM') return 'fcm';
    return isExpoToken(d.token) ? 'expo' : 'fcm';
  }
}
