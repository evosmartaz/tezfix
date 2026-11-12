import { Module } from '@nestjs/common';
import { ENV, type Env } from '../../config/env';
import { CategoriesModule } from '../categories/categories.module';
import { AiService, ANTHROPIC_CLIENT, createAnthropicClient } from './ai.service';

/** Lane A4: Claude Haiku photo-to-category classifier. Exports AiService (the endpoint lives in lane B1). */
@Module({
  imports: [CategoriesModule],
  providers: [AiService, { provide: ANTHROPIC_CLIENT, useFactory: (env: Env) => createAnthropicClient(env), inject: [ENV] }],
  exports: [AiService],
})
export class AiModule {}
