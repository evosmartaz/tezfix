import { CallHandler, ExecutionContext, Inject, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { map, type Observable } from 'rxjs';
import type { z } from 'zod';
import type { Endpoint } from '@tezfiks/shared';
import { ENDPOINT_META } from './route.decorator';
import { ApiException } from './api-exception';
import { ENV, type Env } from '../../config/env';

export function formatIssues(issues: z.core.$ZodIssue[]) {
  return issues.map((i) => ({ path: i.path.join('.'), message: i.message, code: i.code }));
}

function parse(schema: z.ZodType | undefined, value: unknown, where: string): unknown {
  if (!schema) return undefined;
  const r = schema.safeParse(value ?? {});
  if (!r.success) throw new ApiException('VALIDATION_FAILED', { in: where, issues: formatIssues(r.error.issues) });
  return r.data;
}

/** Parses inputs with the endpoint schemas into req.input and optionally validates responses. */
@Injectable()
export class ContractInterceptor implements NestInterceptor {
  private readonly log = new Logger('Contract');

  constructor(
    private readonly reflector: Reflector,
    @Inject(ENV) private readonly env: Env,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const endpoint = this.reflector.get<Endpoint | undefined>(ENDPOINT_META, ctx.getHandler());
    if (!endpoint) return next.handle();
    const req = ctx.switchToHttp().getRequest<{ params: unknown; query: unknown; body: unknown; input?: unknown }>();
    req.input = {
      params: parse(endpoint.params, req.params, 'params'),
      query: parse(endpoint.query, req.query, 'query'),
      body: endpoint.multipart ? undefined : parse(endpoint.body, req.body, 'body'),
    };
    if (endpoint.raw) return next.handle();
    return next.handle().pipe(
      map((out: unknown) => {
        if (!this.env.CONTRACT_VALIDATE_RESPONSES) return out;
        const r = endpoint.response.safeParse(out);
        if (r.success) return out;
        const details = { endpoint: `${endpoint.method} ${endpoint.path}`, issues: formatIssues(r.error.issues) };
        this.log.error(`Response does not match the contract: ${JSON.stringify(details)}`);
        if (this.env.NODE_ENV !== 'production') throw new ApiException('INTERNAL', { contractMismatch: details });
        return out;
      }),
    );
  }
}
