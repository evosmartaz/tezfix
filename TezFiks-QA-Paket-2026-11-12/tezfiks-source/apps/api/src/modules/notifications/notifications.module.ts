import { Module } from '@nestjs/common';
import { ENV, type Env } from '../../config/env';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PushService } from './push/push.service';
import { LogPushSender } from './push/log.sender';
import { ExpoPushSender } from './push/expo.sender';
import { FcmPushSender } from './push/fcm.sender';
import { PUSH_SENDERS, type PushSenders } from './push/push.types';

/** Lane A3: notifications (DB + socket + push), push senders (log/expo/fcm), notification endpoints. */
@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    PushService,
    LogPushSender,
    {
      provide: PUSH_SENDERS,
      inject: [ENV, LogPushSender],
      useFactory: (env: Env, log: LogPushSender): PushSenders => ({
        log,
        expo: new ExpoPushSender(env),
        fcm: new FcmPushSender(env),
      }),
    },
  ],
  exports: [NotificationsService, PushService, LogPushSender],
})
export class NotificationsModule {}
