import { ArgumentsHost, Catch, ExceptionFilter, Inject } from '@nestjs/common';
import type { Request, Response } from 'express';
import { LOCALES, type Locale } from '@tezfiks/shared';
import { ApiException } from '../../common/http/api-exception';
import { ErrorFilter } from '../../common/http/error.filter';
import { I18nService } from '../../common/i18n/i18n.service';
import { ENV, type Env } from '../../config/env';
import { renderInvalidLink } from './checkout-page';

/**
 * Picks the best supported locale from an Accept-Language header (q-values honoured, "ru-RU" matches "ru");
 * falls back to az when nothing matches.
 */
export function checkoutLocale(header: string | string[] | undefined): Locale {
  const raw = Array.isArray(header) ? header.join(',') : (header ?? '');
  const ranked = raw
    .split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.trim().split(';');
      const qParam = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      const q = qParam ? Number(qParam.slice(2)) : 1;
      return { lang: tag.trim().slice(0, 2).toLowerCase(), q: Number.isFinite(q) ? q : 0, index };
    })
    .filter((x) => x.lang && x.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  const hit = ranked.find((x) => (LOCALES as readonly string[]).includes(x.lang));
  return (hit?.lang as Locale | undefined) ?? 'az';
}

/**
 * Scoped to the hosted checkout routes, which a browser opens directly: input that fails the contract schema
 * (missing `t`, a malformed intent id) renders the same 403 "invalid link" HTML page as a bad signature instead of
 * a JSON error body. Every other error falls through to the global JSON error renderer.
 */
@Catch()
export class CheckoutLinkFilter implements ExceptionFilter {
  private readonly fallback: ErrorFilter;

  constructor(
    private readonly i18n: I18nService,
    @Inject(ENV) env: Env,
  ) {
    this.fallback = new ErrorFilter(i18n, env);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    if (
      host.getType() !== 'http' ||
      !(exception instanceof ApiException) ||
      exception.code !== 'VALIDATION_FAILED'
    ) {
      this.fallback.catch(exception, host);
      return;
    }
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    if (res.headersSent) return;
    const locale = checkoutLocale(req.headers['accept-language']);
    const t = (key: string, vars?: Record<string, string | number>) => this.i18n.t(locale, key, vars);
    res.setHeader('Cache-Control', 'no-store');
    res.status(403).type('html').send(renderInvalidLink(locale, t));
  }
}
