import { Injectable, Logger } from '@nestjs/common';
import type { PaymentPurpose, VerificationStatus } from '@tezfiks/shared';

export interface PaymentSettledEvent {
  paymentIntentId: string;
  purpose: PaymentPurpose;
  amount: number;
  payerUserId: string | null;
  assignmentId: string | null;
  invoiceId: string | null;
  walletAccountId: string | null;
  companyId: string | null;
}

/** In-process domain events between modules (no cyclic module imports). Handlers run sequentially and are awaited. */
export interface DomainEventMap {
  'payment.succeeded': PaymentSettledEvent;
  'payment.failed': PaymentSettledEvent & { reason: string };
  'user.blocked': { userId: string; reason: string };
  'handyman.status': { handymanId: string; userId: string; status: VerificationStatus };
  'company.status': { companyId: string; status: VerificationStatus };
  'assignment.status': { assignmentId: string; requestId: string; status: string };
}

type Handler<K extends keyof DomainEventMap> = (payload: DomainEventMap[K]) => Promise<void> | void;

@Injectable()
export class DomainEvents {
  private readonly log = new Logger('DomainEvents');
  private readonly handlers = new Map<keyof DomainEventMap, Array<Handler<never>>>();

  on<K extends keyof DomainEventMap>(event: K, handler: Handler<K>): void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler as Handler<never>);
    this.handlers.set(event, list);
  }

  /** Awaits every handler; the first failure is rethrown after logging. */
  async emit<K extends keyof DomainEventMap>(event: K, payload: DomainEventMap[K]): Promise<void> {
    for (const h of this.handlers.get(event) ?? []) {
      try {
        await (h as Handler<K>)(payload);
      } catch (err) {
        this.log.error(`handler for ${String(event)} failed: ${(err as Error).message}`, (err as Error).stack);
        throw err;
      }
    }
  }
}
