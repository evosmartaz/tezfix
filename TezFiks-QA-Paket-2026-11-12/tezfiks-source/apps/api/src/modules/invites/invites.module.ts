import { Module } from '@nestjs/common';
import { ProModule } from '../pro/pro.module';
import { InvitesController } from './invites.controller';
import { InvitesService } from './invites.service';

/** Lane B2: public invite preview + accept. */
@Module({
  imports: [ProModule],
  controllers: [InvitesController],
  providers: [InvitesService],
  exports: [InvitesService],
})
export class InvitesModule {}
