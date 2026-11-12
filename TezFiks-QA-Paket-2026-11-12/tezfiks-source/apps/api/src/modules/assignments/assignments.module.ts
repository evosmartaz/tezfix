import { Module } from '@nestjs/common';
import { RequestsModule } from '../requests/requests.module';
import { CustomerModule } from '../customer/customer.module';
import { CategoriesModule } from '../categories/categories.module';
import { GeoModule } from '../geo/geo.module';
import { PaymentsModule } from '../payments/payments.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WalletModule } from '../wallet/wallet.module';
import { FilesModule } from '../files/files.module';
import { AssignmentAccess } from './assignment-access.service';
import { CompletionService } from './completion.service';
import { TrackingService } from './tracking.service';
import { ProviderActionsService } from './provider-actions.service';
import { CustomerActionsService } from './customer-actions.service';
import { ProviderBlockService } from './provider-block.service';
import { CompanyAssignmentsController, CustomerAssignmentsController, ProAssignmentsController } from './assignments.controller';

/** Lane B3: assignment lifecycle (customer, pro and company actions), ETA/contact unlock, payment completion, ratings. */
@Module({
  imports: [
    RequestsModule,
    CustomerModule,
    CategoriesModule,
    GeoModule,
    PaymentsModule,
    RealtimeModule,
    NotificationsModule,
    WalletModule,
    FilesModule,
  ],
  controllers: [CustomerAssignmentsController, ProAssignmentsController, CompanyAssignmentsController],
  providers: [AssignmentAccess, CompletionService, TrackingService, ProviderActionsService, CustomerActionsService, ProviderBlockService],
  exports: [AssignmentAccess, CompletionService, TrackingService, ProviderBlockService],
})
export class AssignmentsModule {}
