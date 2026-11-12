import { Controller, Inject, Req, Res, UseFilters } from '@nestjs/common';
import type { Request, Response } from 'express';
import { api, type Locale } from '@tezfiks/shared';
import { Route } from '../../common/http/route.decorator';
import { Input, type RouteInput } from '../../common/http/input.decorator';
import { CurrentPrincipal, CurrentUser } from '../../common/auth/current.decorators';
import type { Principal, UserPrincipal } from '../../common/auth/types';
import { ApiException } from '../../common/http/api-exception';
import { I18nService } from '../../common/i18n/i18n.service';
import { WalletAccessService } from '../wallet/wallet-access.service';
import { PaymentsService, type SettleStatus } from './payments.service';
import { FakePaymentProvider } from './payment-provider';
import { renderCheckoutForm, renderCheckoutResult, renderInvalidLink } from './checkout-page';
import { sanitizeReturnUrl, withPaymentResult } from './return-url';
import { ENV, type Env } from '../../config/env';
import { CheckoutLinkFilter, checkoutLocale } from './checkout-link.filter';

/** Test cards of the fake provider (spec 7.1). */
export const TEST_CARD_SUCCESS = '4242424242424242';
export const TEST_CARD_DECLINED = '4000000000000002';

function localeOf(req: Request): Locale {
  return checkoutLocale(req.headers['accept-language']);
}

/** Payment intents, the hosted TEST checkout page, wallet top-ups (self and company) and the admin payments list. */
@Controller()
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly access: WalletAccessService,
    private readonly fake: FakePaymentProvider,
    private readonly i18n: I18nService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Route(api.wallet.topup)
  async topup(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.wallet.topup>) {
    const w = await this.access.resolveSelf(user, input.body.owner);
    const { intent, checkoutUrl } = await this.payments.createIntent({
      purpose: 'WALLET_TOPUP',
      amount: input.body.amount,
      payerUserId: user.userId,
      creditAccountId: w.accountId,
      returnUrl: input.body.returnUrl,
    });
    return { paymentIntentId: intent.id, checkoutUrl };
  }

  @Route(api.company.topup)
  async companyTopup(
    @CurrentUser() user: UserPrincipal,
    @Input() input: RouteInput<typeof api.company.topup>,
  ) {
    const company = await this.access.managedCompany(user.userId, input.params.companyId);
    const { intent, checkoutUrl } = await this.payments.createIntent({
      purpose: 'WALLET_TOPUP',
      amount: input.body.amount,
      payerUserId: user.userId,
      creditAccountId: company.walletAccountId,
      companyId: company.id,
      returnUrl: input.body.returnUrl,
    });
    return { paymentIntentId: intent.id, checkoutUrl };
  }

  @Route(api.payments.get)
  async get(
    @CurrentPrincipal() principal: Principal | undefined,
    @Input() input: RouteInput<typeof api.payments.get>,
  ) {
    const intent = await this.payments.find(input.params.id);
    if (!intent || !principal) throw new ApiException('NOT_FOUND', { entity: 'PaymentIntent' });
    let allowed = principal.kind === 'admin';
    if (!allowed && principal.kind === 'user') {
      allowed =
        intent.payerUserId === principal.userId ||
        (!!intent.companyId && (await this.access.isCompanyManager(principal.userId, intent.companyId)));
    }
    if (!allowed) throw new ApiException('NOT_FOUND', { entity: 'PaymentIntent' });
    return this.payments.view(intent);
  }

  @Route(api.payments.checkoutPage)
  @UseFilters(CheckoutLinkFilter)
  async checkoutPage(
    @Input() input: RouteInput<typeof api.payments.checkoutPage>,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const locale = localeOf(req);
    const t = (key: string, vars?: Record<string, string | number>) => this.i18n.t(locale, key, vars);
    const intent = await this.payments.find(input.params.id);
    res.setHeader('Cache-Control', 'no-store');
    // Outside the demo the test checkout is closed: an old link can neither show the form nor book money.
    if (!this.payments.cardPaymentsEnabled || !intent || intent.provider !== this.fake.name || !this.fake.verify(intent.id, input.query.t)) {
      res.status(403).type('html').send(renderInvalidLink(locale, t));
      return;
    }
    if (intent.status === 'CREATED') {
      res
        .status(200)
        .type('html')
        .send(
          renderCheckoutForm(locale, t, {
            intentId: intent.id,
            token: input.query.t,
            amount: Number(intent.amount),
            purpose: intent.purpose,
          }),
        );
      return;
    }
    const back = sanitizeReturnUrl(intent.returnUrl, this.env);
    res
      .status(200)
      .type('html')
      .send(
        renderCheckoutResult(locale, t, {
          status: intent.status,
          amount: Number(intent.amount),
          failureReason: intent.failureReason,
          returnUrl: back ? withPaymentResult(back, intent.id, intent.status) : null,
        }),
      );
  }

  @Route(api.payments.checkoutSubmit)
  @UseFilters(CheckoutLinkFilter)
  async checkoutSubmit(
    @Input() input: RouteInput<typeof api.payments.checkoutSubmit>,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const locale = localeOf(req);
    const t = (key: string, vars?: Record<string, string | number>) => this.i18n.t(locale, key, vars);
    const form = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const token = typeof form.t === 'string' ? form.t : '';
    res.setHeader('Cache-Control', 'no-store');
    let intent = await this.payments.find(input.params.id);
    if (!this.payments.cardPaymentsEnabled || !intent || intent.provider !== this.fake.name || !this.fake.verify(intent.id, token)) {
      res.status(403).type('html').send(renderInvalidLink(locale, t));
      return;
    }
    if (intent.status === 'CREATED') {
      const action = typeof form.action === 'string' ? form.action : 'pay';
      const card = (typeof form.card === 'string' ? form.card : '').replace(/[\s-]/g, '');
      let status: SettleStatus;
      let reason: string | null = null;
      if (action === 'cancel') {
        status = 'CANCELLED';
        reason = 'cancelled';
      } else if (card === TEST_CARD_SUCCESS) {
        status = 'SUCCEEDED';
      } else if (card === TEST_CARD_DECLINED) {
        status = 'FAILED';
        reason = 'card_declined';
      } else {
        status = 'FAILED';
        reason = 'unsupported_test_card';
      }
      intent = await this.payments.settle(intent.id, status, reason);
    }
    const back = sanitizeReturnUrl(intent.returnUrl, this.env);
    if (back) {
      res.redirect(303, withPaymentResult(back, intent.id, intent.status));
      return;
    }
    res
      .status(200)
      .type('html')
      .send(
        renderCheckoutResult(locale, t, {
          status: intent.status,
          amount: Number(intent.amount),
          failureReason: intent.failureReason,
          returnUrl: null,
        }),
      );
  }

  @Route(api.admin.payments)
  async adminPayments(@Input() input: RouteInput<typeof api.admin.payments>) {
    return this.payments.listAdmin(input.query);
  }
}
