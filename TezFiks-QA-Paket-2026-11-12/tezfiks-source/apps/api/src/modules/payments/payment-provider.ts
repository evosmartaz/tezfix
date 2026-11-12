import { Inject, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ENV, type Env } from '../../config/env';
import type { PaymentIntent } from '../../generated/prisma/client';

/**
 * Payment provider port (spec 7.1). The demo ships the `fake` provider with a hosted TEST checkout page served by this API;
 * Payriff / Epoint plug in here later (create a checkout session, return its URL, settle from their callback).
 */
export interface PaymentProvider {
  readonly name: string;
  /** Prepares the provider side of a new intent; returns the provider reference (if any). */
  createCheckout(intent: PaymentIntent): Promise<{ providerRef: string | null }>;
  /** URL the payer opens to pay the intent (null when the provider has none). */
  checkoutUrl(intent: Pick<PaymentIntent, 'id' | 'provider' | 'providerRef'>): string | null;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

/** Name of the test-mode provider: only usable in the demo or with PAYMENTS_TEST_MODE (see PaymentsService.cardPaymentsEnabled). */
export const FAKE_PROVIDER_NAME = 'fake';

/** Test-mode provider: `${publicApiUrl}/pay/checkout/<id>?t=<HMAC(id)>`, paid on the page served by PaymentsController. */
@Injectable()
export class FakePaymentProvider implements PaymentProvider {
  readonly name = FAKE_PROVIDER_NAME;

  constructor(@Inject(ENV) private readonly env: Env) {}

  async createCheckout(): Promise<{ providerRef: string | null }> {
    return { providerRef: null };
  }

  checkoutUrl(intent: Pick<PaymentIntent, 'id'>): string {
    return `${this.env.publicApiUrl}/pay/checkout/${intent.id}?t=${this.token(intent.id)}`;
  }

  /** HMAC of the intent id with a key derived from JWT_SECRET (never reused for anything else). */
  token(intentId: string): string {
    return createHmac('sha256', `checkout:${this.env.JWT_SECRET}`).update(intentId).digest('base64url');
  }

  verify(intentId: string, token: string | null | undefined): boolean {
    if (!token || typeof token !== 'string') return false;
    const expected = Buffer.from(this.token(intentId));
    const given = Buffer.from(token);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }
}
