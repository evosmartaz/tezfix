import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { FakePaymentProvider, PAYMENT_PROVIDER } from './payment-provider';

/** Lane A2: payment intents, PaymentProvider port, fake provider with hosted test checkout page, wallet top-ups. */
@Module({
  imports: [WalletModule],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    FakePaymentProvider,
    { provide: PAYMENT_PROVIDER, useExisting: FakePaymentProvider },
  ],
  exports: [PaymentsService, PAYMENT_PROVIDER],
})
export class PaymentsModule {}
