import { Module } from '@nestjs/common';
import { WalletController } from './wallet.controller';
import { WalletAccessService } from './wallet-access.service';
import { WalletEventsService } from './wallet-events.service';
import { WalletAdminService } from './wallet-admin.service';
import { LedgerIntegrityService } from './ledger-integrity.service';

/** Lane A2: wallet endpoints (self), company wallet reads, admin adjustments and ledger explorer, wallet:updated events, nightly integrity check. */
@Module({
  controllers: [WalletController],
  providers: [WalletAccessService, WalletEventsService, WalletAdminService, LedgerIntegrityService],
  exports: [WalletAccessService, WalletEventsService, WalletAdminService, LedgerIntegrityService],
})
export class WalletModule {}
