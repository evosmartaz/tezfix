import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TokenService } from './auth/token.service';
import { SessionsService } from './auth/sessions.service';
import { I18nService } from './i18n/i18n.service';
import { SettingsService } from './settings/settings.service';
import { AuditService } from './audit/audit.service';

@Global()
@Module({
  imports: [JwtModule.register({})],
  providers: [TokenService, SessionsService, I18nService, SettingsService, AuditService],
  exports: [TokenService, SessionsService, I18nService, SettingsService, AuditService, JwtModule],
})
export class CommonModule {}
