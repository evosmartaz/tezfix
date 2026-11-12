import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from './config/config.module';
import { InfraModule } from './infra/infra.module';
import { CommonModule } from './common/common.module';
import { AuthGuard } from './common/auth/auth.guard';
import { ContractInterceptor } from './common/http/contract.interceptor';
import { IdempotencyInterceptor } from './common/http/idempotency.interceptor';
import { ErrorFilter } from './common/http/error.filter';
import { LedgerModule } from './modules/ledger/ledger.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { FilesModule } from './modules/files/files.module';
import { WalletModule } from './modules/wallet/wallet.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { PayoutsModule } from './modules/payouts/payouts.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { GeoModule } from './modules/geo/geo.module';
import { AiModule } from './modules/ai/ai.module';
import { CustomerModule } from './modules/customer/customer.module';
import { RequestsModule } from './modules/requests/requests.module';
import { ProModule } from './modules/pro/pro.module';
import { KycModule } from './modules/kyc/kyc.module';
import { CompanyModule } from './modules/company/company.module';
import { InvitesModule } from './modules/invites/invites.module';
import { AssignmentsModule } from './modules/assignments/assignments.module';
import { ChatModule } from './modules/chat/chat.module';
import { CasesModule } from './modules/cases/cases.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { AdminModule } from './modules/admin/admin.module';
import { DemoModule } from './modules/demo/demo.module';

@Module({
  imports: [
    ConfigModule,
    InfraModule,
    CommonModule,
    LedgerModule,
    HealthModule,
    AuthModule,
    UsersModule,
    FilesModule,
    WalletModule,
    PaymentsModule,
    PayoutsModule,
    RealtimeModule,
    NotificationsModule,
    CategoriesModule,
    GeoModule,
    AiModule,
    CustomerModule,
    RequestsModule,
    ProModule,
    KycModule,
    CompanyModule,
    InvitesModule,
    AssignmentsModule,
    ChatModule,
    CasesModule,
    ProjectsModule,
    AdminModule,
    DemoModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: ContractInterceptor },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_FILTER, useClass: ErrorFilter },
  ],
})
export class AppModule {}
