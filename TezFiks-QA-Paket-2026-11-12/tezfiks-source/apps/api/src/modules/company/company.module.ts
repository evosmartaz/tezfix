import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { FilesModule } from '../files/files.module';
import { WalletModule } from '../wallet/wallet.module';
import { ProModule } from '../pro/pro.module';
import { CompanyController } from './company.controller';
import { CompanyService } from './company.service';

/**
 * Lane B2: company profile/settings, members, invites, workers live. Exports CompanyService.
 * (Company wallet/earnings/payout endpoints live in WalletModule / PayoutsModule, lane A2; company offers in lane B1.)
 */
@Module({
  imports: [RealtimeModule, FilesModule, WalletModule, ProModule],
  controllers: [CompanyController],
  providers: [CompanyService],
  exports: [CompanyService],
})
export class CompanyModule {}
