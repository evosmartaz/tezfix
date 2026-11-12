import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { PayoutsController } from './payouts.controller';
import { PayoutsService } from './payouts.service';

/** Lane A2: weekly payouts, payout methods, earnings views. */
@Module({
  imports: [WalletModule],
  controllers: [PayoutsController],
  providers: [PayoutsService],
  exports: [PayoutsService],
})
export class PayoutsModule {}
