import type { AdminRole, AppKind } from '@tezfiks/shared';

export interface UserPrincipal {
  kind: 'user';
  userId: string;
  sessionId: string;
  app: AppKind;
}

export interface AdminPrincipal {
  kind: 'admin';
  adminId: string;
  sessionId: string;
  role: AdminRole;
}

export type Principal = UserPrincipal | AdminPrincipal;

export interface AccessClaims {
  sub: string;
  typ: 'user' | 'admin';
  sid: string;
  app?: AppKind;
  role?: AdminRole;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
}
