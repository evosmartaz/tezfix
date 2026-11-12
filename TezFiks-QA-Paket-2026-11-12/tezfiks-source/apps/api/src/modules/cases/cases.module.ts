import { Module } from '@nestjs/common';
import { AssignmentsModule } from '../assignments/assignments.module';
import { RequestsModule } from '../requests/requests.module';
import { FilesModule } from '../files/files.module';
import { CasesController, AdminCasesController } from './cases.controller';
import { CasesService } from './cases.service';
import { AdminCasesService } from './admin-cases.service';
import { CaseViews } from './case-views.service';

/** Lane B3: guarantee claims and price disputes (customer side and admin decisions). */
@Module({
  imports: [AssignmentsModule, RequestsModule, FilesModule],
  controllers: [CasesController, AdminCasesController],
  providers: [CasesService, AdminCasesService, CaseViews],
  exports: [CaseViews],
})
export class CasesModule {}
