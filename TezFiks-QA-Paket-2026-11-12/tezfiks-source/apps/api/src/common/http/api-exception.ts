import { HttpException } from '@nestjs/common';
import { ERROR_HTTP_STATUS, type ErrorCode } from '@tezfiks/shared';

/**
 * The only exception business code should throw. Rendered as
 * { "error": { "code", "message" (localized from common.errors.<code>), "details" } }.
 */
export class ApiException extends HttpException {
  constructor(
    public readonly code: ErrorCode,
    public readonly details?: unknown,
    status?: number,
    public readonly messageOverride?: string,
  ) {
    super({ code, details }, status ?? ERROR_HTTP_STATUS[code]);
  }
}

export function notFound(details?: unknown): ApiException {
  return new ApiException('NOT_FOUND', details);
}

export function forbidden(details?: unknown): ApiException {
  return new ApiException('FORBIDDEN', details);
}

export function invalidState(details?: unknown): ApiException {
  return new ApiException('INVALID_STATE', details);
}
