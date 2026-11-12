import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Inject, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { asLocale, type ErrorCode } from '@tezfiks/shared';
import { ApiException } from './api-exception';
import { I18nService } from '../i18n/i18n.service';
import { ENV, type Env } from '../../config/env';

const STATUS_CODES: Record<number, ErrorCode> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'FILE_TOO_LARGE',
  415: 'FILE_TYPE_NOT_ALLOWED',
  429: 'RATE_LIMITED',
};

/** Deadlock / serialization failure: Prisma P2034, or a raw query that failed with Postgres 40P01 / 40001. Safe to retry. */
export function isWriteConflict(exception: unknown): boolean {
  const e = exception as { code?: unknown; meta?: { driverAdapterError?: { cause?: { kind?: unknown; originalCode?: unknown } } } };
  if (e?.code === 'P2034') return true;
  const cause = e?.meta?.driverAdapterError?.cause;
  return cause?.kind === 'TransactionWriteConflict' || cause?.originalCode === '40P01' || cause?.originalCode === '40001';
}

export function requestLocale(req: Request): ReturnType<typeof asLocale> {
  const header = String(req.headers['accept-language'] ?? '');
  return asLocale(header.split(',')[0]?.trim());
}

/** Renders every error as { error: { code, message, details } } with a localized message. */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly log = new Logger('Errors');

  constructor(
    private readonly i18n: I18nService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') return;
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    if (res.headersSent) return;
    let status = 500;
    let code: string = 'INTERNAL';
    let details: unknown;
    let message: string | undefined;

    if (exception instanceof ApiException) {
      status = exception.getStatus();
      code = exception.code;
      details = exception.details;
      message = exception.messageOverride;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = STATUS_CODES[status] ?? (status >= 500 ? 'INTERNAL' : 'VALIDATION_FAILED');
      const body = exception.getResponse();
      if (status < 500 && typeof body === 'object') details = body;
    } else if (exception && typeof exception === 'object' && 'code' in exception && typeof (exception as { code: unknown }).code === 'string') {
      const prismaCode = (exception as { code: string }).code;
      if (prismaCode === 'P2002') {
        status = 409;
        code = 'CONFLICT';
      } else if (prismaCode === 'P2025') {
        status = 404;
        code = 'NOT_FOUND';
      } else if (isWriteConflict(exception)) {
        status = 409;
        code = 'CONFLICT';
        details = { reason: 'WRITE_CONFLICT', retryable: true };
      }
    }

    if (status >= 500) {
      const err = exception as Error;
      this.log.error(`${req.method} ${req.url} -> ${status}: ${err?.message ?? String(exception)}`, err?.stack);
      if (this.env.NODE_ENV === 'production' && !(exception instanceof ApiException)) details = undefined;
      else if (!(exception instanceof ApiException) && !details) details = { message: err?.message };
    }

    const locale = requestLocale(req);
    res.status(status).json({
      error: {
        code,
        message: message ?? this.i18n.t(locale, `common.errors.${code}`),
        ...(details === undefined ? {} : { details }),
      },
    });
  }
}
