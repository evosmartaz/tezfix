import { Module } from '@nestjs/common';
import { AssignmentsModule } from '../assignments/assignments.module';
import { RequestsModule } from '../requests/requests.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

/** Lane B3: assignment chat (unlocks with contact). */
@Module({
  imports: [AssignmentsModule, RequestsModule],
  controllers: [ChatController],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
