import { Module } from '@nestjs/common';
import { CustomerModule } from '../customer/customer.module';
import { CategoriesModule } from '../categories/categories.module';
import { FilesModule } from '../files/files.module';
import { AiModule } from '../ai/ai.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WalletModule } from '../wallet/wallet.module';
import { RequestsController } from './requests.controller';
import { OffersController } from './offers.controller';
import { RequestsService } from './requests.service';
import { OffersService } from './offers.service';
import { RequestStateService } from './request-state.service';
import { RequestNotifier } from './request-notifier';
import { FeesService } from './fees.service';
import { CancellationService } from './cancellation.service';
import { RequestViews } from './views/request-views.service';
import { DispatchService } from './dispatch/dispatch.service';
import { EligibilityService } from './dispatch/eligibility.service';

/**
 * Lane B1: requests (create/list/get/cancel, classify-photo), the H3 dispatch engine, offers (solo + company accept),
 * fee-window capture and cancellations. Exports the services lane B3 builds on.
 */
@Module({
  imports: [CustomerModule, CategoriesModule, FilesModule, AiModule, RealtimeModule, NotificationsModule, WalletModule],
  controllers: [RequestsController, OffersController],
  providers: [
    RequestsService,
    OffersService,
    RequestStateService,
    RequestNotifier,
    FeesService,
    CancellationService,
    RequestViews,
    DispatchService,
    EligibilityService,
  ],
  exports: [RequestStateService, FeesService, CancellationService, RequestViews, DispatchService, EligibilityService, OffersService, RequestNotifier],
})
export class RequestsModule {}
