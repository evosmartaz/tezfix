import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { FilesModule } from '../files/files.module';
import { CategoriesModule } from '../categories/categories.module';
import { ProController } from './pro.controller';
import { ProService } from './pro.service';
import { ProviderViewsService } from './provider-views.service';
import { ProviderLiveService } from './provider-live.service';

/**
 * Lane B2: handyman onboarding, profile, online/location, today's stats. Exports the provider read models
 * (ProviderViewsService) and live-effect helpers (ProviderLiveService) used by the company, invites and kyc modules.
 * (Earnings / payout method endpoints live in PayoutsModule, lane A2.)
 */
@Module({
  imports: [RealtimeModule, FilesModule, CategoriesModule],
  controllers: [ProController],
  providers: [ProService, ProviderViewsService, ProviderLiveService],
  exports: [ProService, ProviderViewsService, ProviderLiveService],
})
export class ProModule {}
