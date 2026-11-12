import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { asLocale, type Locale } from '@tezfiks/shared';
import { ApiException } from '../http/api-exception';
import type { AdminPrincipal, Principal, UserPrincipal } from './types';

type Req = { auth?: Principal; headers: Record<string, string | undefined>; ip?: string };

/** The authenticated phone user (mobile apps / company panel). */
export const CurrentUser = createParamDecorator((_d: unknown, ctx: ExecutionContext): UserPrincipal => {
  const auth = ctx.switchToHttp().getRequest<Req>().auth;
  if (!auth || auth.kind !== 'user') throw new ApiException('UNAUTHORIZED');
  return auth;
});

/** The authenticated TezFiks admin. */
export const CurrentAdmin = createParamDecorator((_d: unknown, ctx: ExecutionContext): AdminPrincipal => {
  const auth = ctx.switchToHttp().getRequest<Req>().auth;
  if (!auth || auth.kind !== 'admin') throw new ApiException('UNAUTHORIZED');
  return auth;
});

/** User or admin, or undefined on public endpoints. */
export const CurrentPrincipal = createParamDecorator(
  (_d: unknown, ctx: ExecutionContext): Principal | undefined => ctx.switchToHttp().getRequest<Req>().auth,
);

/** Locale from Accept-Language (az default). */
export const ReqLocale = createParamDecorator((_d: unknown, ctx: ExecutionContext): Locale => {
  const header = String(ctx.switchToHttp().getRequest<Req>().headers['accept-language'] ?? '');
  return asLocale(header.split(',')[0]?.trim());
});

export const ClientIp = createParamDecorator((_d: unknown, ctx: ExecutionContext): string | null => {
  return ctx.switchToHttp().getRequest<Req>().ip ?? null;
});

export const UserAgent = createParamDecorator((_d: unknown, ctx: ExecutionContext): string | null => {
  return ctx.switchToHttp().getRequest<Req>().headers['user-agent'] ?? null;
});
