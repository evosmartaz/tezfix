import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { WalletModule } from '../wallet/wallet.module';
import { CategoriesModule } from '../categories/categories.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProModule } from '../pro/pro.module';
import { KycController } from './kyc.controller';
import { AdminProvidersController } from './admin-providers.controller';
import { KycService } from './kyc.service';
import { ProviderReviewService } from './provider-review.service';
import { AdminProvidersService } from './admin-providers.service';

/**
 * Lane B2: KYC submissions/status, admin review of handymen and companies (approve/reject/block/unblock/strikes),
 * admin provider lists/details and user blocking.
 */
@Module({
  imports: [FilesModule, WalletModule, CategoriesModule, NotificationsModule, ProModule],
  controllers: [KycController, AdminProvidersController],
  providers: [KycService, ProviderReviewService, AdminProvidersService],
  exports: [KycService, ProviderReviewService, AdminProvidersService],
})
export class KycModule {}
