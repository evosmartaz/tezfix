import { Module } from '@nestjs/common';
import { ENV, type Env } from '../../config/env';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { WhatsAppWebhookController } from './whatsapp-webhook.controller';
import { OtpService } from './otp.service';
import { AdminAuthService } from './admin-auth.service';
import { OTP_CHANNEL, OTP_FETCH, createOtpChannel, type FetchFn } from './otp/otp-channel';

/** Lane A1: OTP login (WhatsApp/console/webhook channels), refresh, logout, admin login, realtime ticket, WhatsApp webhook. */
@Module({
  imports: [UsersModule],
  controllers: [AuthController, WhatsAppWebhookController],
  providers: [
    OtpService,
    AdminAuthService,
    { provide: OTP_FETCH, useValue: ((input: string, init?: RequestInit) => fetch(input, init)) satisfies FetchFn },
    { provide: OTP_CHANNEL, inject: [ENV, OTP_FETCH], useFactory: (env: Env, fetchFn: FetchFn) => createOtpChannel(env, fetchFn) },
  ],
  exports: [OtpService, AdminAuthService],
})
export class AuthModule {}
