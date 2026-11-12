import { Module } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';
import { PresenceService } from './presence.service';
import { RoomAccessService } from './room-access.service';

/** Lane A3: Socket.IO gateway (auth handshake, rooms), presence store (Redis H3 cells), location ingestion hook. */
@Module({
  providers: [RealtimeGateway, PresenceService, RoomAccessService],
  exports: [PresenceService, RoomAccessService],
})
export class RealtimeModule {}
