import { Module } from '@nestjs/common';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { AdminCategoriesService } from './admin-categories.service';

/** Lane A4: categories (public + admin CRUD). Exports CategoriesService. */
@Module({
  controllers: [CategoriesController],
  providers: [CategoriesService, AdminCategoriesService],
  exports: [CategoriesService],
})
export class CategoriesModule {}
