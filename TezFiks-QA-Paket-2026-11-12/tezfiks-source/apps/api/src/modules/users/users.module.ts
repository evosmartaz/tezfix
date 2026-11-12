import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { UsersController } from './users.controller';
import { MeService } from './me.service';

/** Lane A1: /me endpoints, devices, account deletion. */
@Module({
  imports: [FilesModule],
  controllers: [UsersController],
  providers: [MeService],
  exports: [MeService],
})
export class UsersModule {}
