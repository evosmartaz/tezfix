import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Endpoint } from '@tezfiks/shared';
import { ENDPOINT_META } from '../http/route.decorator';
import { ApiException } from '../http/api-exception';
import { TokenService } from './token.service';
import { SessionsService } from './sessions.service';
import type { Principal } from './types';

function bearer(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}

/** Global guard: enforces the contract's `auth` kind and attaches req.auth. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly sessions: SessionsService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const endpoint = this.reflector.get<Endpoint | undefined>(ENDPOINT_META, ctx.getHandler());
    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string | undefined>; auth?: Principal }>();
    const token = bearer(req.headers.authorization);
    if (!endpoint || endpoint.auth === 'none') {
      if (token) {
        try {
          const p = this.tokens.verifyAccess(token);
          await this.sessions.validate(p);
          req.auth = p;
        } catch {
          // optional auth on public endpoints
        }
      }
      return true;
    }
    if (!token) throw new ApiException('UNAUTHORIZED');
    const p = this.tokens.verifyAccess(token);
    if (endpoint.auth === 'user' && p.kind !== 'user') throw new ApiException('FORBIDDEN');
    if (endpoint.auth === 'admin' && p.kind !== 'admin') throw new ApiException('FORBIDDEN');
    await this.sessions.validate(p);
    req.auth = p;
    return true;
  }
}
