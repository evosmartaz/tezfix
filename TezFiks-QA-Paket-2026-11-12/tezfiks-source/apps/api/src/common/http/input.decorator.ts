import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Endpoint, EndpointBody, EndpointParams, EndpointQuery } from '@tezfiks/shared';

/** Parsed (zod output) params, query and body of a @Route endpoint. Multipart bodies are NOT parsed here. */
export interface RouteInput<E extends Endpoint> {
  params: EndpointParams<E>;
  query: EndpointQuery<E>;
  body: EndpointBody<E>;
}

export const Input = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<{ input?: unknown }>();
  return req.input;
});
