import { z } from 'zod';
import { endpoint } from '../define';
import { Id, IsoDateTime, Ok } from '../common';
import { AdminRole, LocaleSchema } from '../../enums';
import { MeSchema } from './me';

export const LoginApp = z.enum(['CUSTOMER', 'PRO', 'PANEL']);
export type LoginApp = z.infer<typeof LoginApp>;

export const OtpRequestBodySchema = z.object({
  phone: z.string().trim().min(5).max(32),
  app: LoginApp,
  locale: LocaleSchema.optional(),
});

export const OtpRequestResponseSchema = z.object({
  challengeId: Id,
  /** Normalized E.164 phone. */
  phone: z.string(),
  expiresAt: IsoDateTime,
  resendAfterSec: z.int(),
  channel: z.string(),
  /** Only when OTP_DEV_ECHO=true (development). Never in production. */
  devCode: z.string().optional(),
});

export const OtpVerifyBodySchema = z.object({
  challengeId: Id,
  code: z.string().regex(/^\d{6}$/),
  deviceId: z.string().min(8).max(128),
  app: LoginApp,
});

export const AuthTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  accessExpiresAt: IsoDateTime,
  refreshExpiresAt: IsoDateTime,
});
export type AuthTokens = z.infer<typeof AuthTokensSchema>;

export const OtpVerifyResponseSchema = z.object({
  tokens: AuthTokensSchema,
  me: MeSchema,
  isNewUser: z.boolean(),
});

export const RefreshBodySchema = z.object({
  refreshToken: z.string().min(10),
  deviceId: z.string().min(8).max(128).optional(),
});

export const AdminMeSchema = z.object({
  id: Id,
  email: z.string(),
  name: z.string(),
  role: AdminRole.schema,
});
export type AdminMe = z.infer<typeof AdminMeSchema>;

export const AdminLoginBodySchema = z.object({
  email: z.email().max(200),
  password: z.string().min(1).max(200),
});

export const RealtimeTicketSchema = z.object({ ticket: z.string(), expiresAt: IsoDateTime });

export const authEndpoints = {
  otpRequest: endpoint({
    method: 'POST',
    path: '/auth/otp/request',
    auth: 'none',
    body: OtpRequestBodySchema,
    response: OtpRequestResponseSchema,
    summary: 'Sends a 6-digit login code over WhatsApp (or the configured channel)',
  }),
  otpVerify: endpoint({
    method: 'POST',
    path: '/auth/otp/verify',
    auth: 'none',
    body: OtpVerifyBodySchema,
    response: OtpVerifyResponseSchema,
  }),
  refresh: endpoint({
    method: 'POST',
    path: '/auth/refresh',
    auth: 'none',
    body: RefreshBodySchema,
    response: AuthTokensSchema,
    summary: 'Rotates the refresh token (user or admin session). Reusing an old refresh token revokes the session.',
  }),
  logout: endpoint({
    method: 'POST',
    path: '/auth/logout',
    auth: 'any',
    body: z.object({ refreshToken: z.string().optional() }),
    response: Ok,
  }),
  adminLogin: endpoint({
    method: 'POST',
    path: '/auth/admin/login',
    auth: 'none',
    body: AdminLoginBodySchema,
    response: z.object({ tokens: AuthTokensSchema, admin: AdminMeSchema }),
  }),
  realtimeTicket: endpoint({
    method: 'POST',
    path: '/realtime/ticket',
    auth: 'any',
    response: RealtimeTicketSchema,
    summary: '60-second single-use ticket for the Socket.IO handshake (web panels)',
  }),
};
