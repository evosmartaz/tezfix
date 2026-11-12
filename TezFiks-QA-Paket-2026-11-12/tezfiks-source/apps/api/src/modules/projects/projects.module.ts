import { Module } from '@nestjs/common';
import { CustomerModule } from '../customer/customer.module';
import { CategoriesModule } from '../categories/categories.module';
import { FilesModule } from '../files/files.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WalletModule } from '../wallet/wallet.module';
import { AdminProjectsController, ProjectsController, ProviderProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { ProviderProjectsService } from './provider-projects.service';
import { ProjectAdminService } from './project-admin.service';
import { ProjectViews } from './project-views.service';
import { ProjectNotifier } from './project-notifier';
import { ProviderActorService } from './provider-actor.service';

/**
 * Lane B4: B2B projects (spec 4.10, 6.6): customer projects and quote acceptance, provider quotes with fee holds, daily reports,
 * completion with the invoice, admin invoice payment. Timers: projects.quoteDeadline, projects.awardExpiry; reconciler projects.repair.
 */
@Module({
  imports: [CustomerModule, CategoriesModule, FilesModule, NotificationsModule, WalletModule],
  controllers: [ProjectsController, ProviderProjectsController, AdminProjectsController],
  providers: [ProjectsService, ProviderProjectsService, ProjectAdminService, ProjectViews, ProjectNotifier, ProviderActorService],
  exports: [ProjectsService, ProjectViews, ProviderActorService],
})
export class ProjectsModule {}
