import { Injectable, Logger } from '@nestjs/common';
import type { PushDelivery, PushMessage, PushSendResult, PushSender } from './push.types';

export interface LoggedPush {
  delivery: PushDelivery;
  message: PushMessage;
}

/** Default sender: records every push in memory (tests inspect `sent`) and logs a one-line summary. */
@Injectable()
export class LogPushSender implements PushSender {
  readonly name = 'log' as const;
  private readonly log = new Logger('Push');
  readonly sent: LoggedPush[] = [];

  async send(deliveries: PushDelivery[], message: PushMessage): Promise<PushSendResult[]> {
    for (const delivery of deliveries) {
      this.sent.push({ delivery, message });
      this.log.debug(`[log push] ${message.type} -> user ${delivery.userId} (${delivery.app}) "${message.title}"`);
    }
    if (this.sent.length > 5000) this.sent.splice(0, 1000);
    return deliveries.map((d) => ({ token: d.token, ok: true, unregistered: false }));
  }

  /** Test helper: pushes sent to a user (optionally of one type). */
  sentTo(userId: string, type?: string): LoggedPush[] {
    return this.sent.filter((s) => s.delivery.userId === userId && (!type || s.message.type === type));
  }

  clear(): void {
    this.sent.length = 0;
  }
}
