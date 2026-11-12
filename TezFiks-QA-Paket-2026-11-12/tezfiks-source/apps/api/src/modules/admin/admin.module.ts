import { Module } from '@nestjs/common';
import { AssignmentsModule } from '../assignments/assignments.module';
import { CategoriesModule } from '../categories/categories.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { RequestsModule } from '../requests/requests.module';
import { WalletModule } from '../wallet/wallet.module';
import { AdminController } from './admin.controller';
import { AdminUsersService } from './admin-users.service';
import { AdminDashboardService } from './admin-dashboard.service';
import { AdminRequestsService } from './admin-requests.service';
import { AdminCustomersService } from './admin-customers.service';
import { AdminSettingsService } from './admin-settings.service';
import { AdminAuditService } from './admin-audit.service';

/**
 * Lane B5: /admin endpoints not owned by other lanes (me, dashboard, requests + force-cancel, customers, settings, admins,
 * audit, live map). Categories, providers, money, cases, projects and demo admin endpoints live in their own modules.
 */
@Module({
  imports: [AssignmentsModule, CategoriesModule, RealtimeModule, RequestsModule, WalletModule],
  controllers: [AdminController],
  providers: [
    AdminUsersService,
    AdminDashboardService,
    AdminRequestsService,
    AdminCustomersService,
    AdminSettingsService,
    AdminAuditService,
  ],
  exports: [AdminUsersService, AdminRequestsService],
})
export class AdminModule {}
