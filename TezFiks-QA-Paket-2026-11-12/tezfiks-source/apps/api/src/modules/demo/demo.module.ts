import { Module } from '@nestjs/common';
import { RequestsModule } from '../requests/requests.module';
import { AssignmentsModule } from '../assignments/assignments.module';
import { ProModule } from '../pro/pro.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { CategoriesModule } from '../categories/categories.module';
import { CustomerModule } from '../customer/customer.module';
import { GeoModule } from '../geo/geo.module';
import { WalletModule } from '../wallet/wallet.module';
import { DemoController } from './demo.controller';
import { DemoConfigService } from './demo-config.service';
import { DemoBotsService } from './demo-bots.service';
import { DemoRequestsService } from './demo-requests.service';
import { DemoSimulatorService } from './demo-simulator.service';
import { DemoSeedService } from './demo-seed.service';

/** Lane B6: demo simulator (bot handymen, auto accept/drive/price), demo admin endpoints and the demo seed. */
@Module({
  imports: [RequestsModule, AssignmentsModule, ProModule, RealtimeModule, CategoriesModule, CustomerModule, GeoModule, WalletModule],
  controllers: [DemoController],
  providers: [DemoConfigService, DemoBotsService, DemoRequestsService, DemoSimulatorService, DemoSeedService],
  exports: [DemoConfigService, DemoBotsService, DemoRequestsService, DemoSimulatorService, DemoSeedService],
})
export class DemoModule {}
