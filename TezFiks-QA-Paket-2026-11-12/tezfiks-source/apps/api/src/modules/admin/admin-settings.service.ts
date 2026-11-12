import { Injectable } from '@nestjs/common';
import { PlatformSettingsSchema, type EndpointOutput, type PlatformSettings, type api } from '@tezfiks/shared';
import { PrismaService, inTx } from '../../infra/prisma.service';
import { RealtimeService } from '../../infra/realtime.service';
import { ApiException } from '../../common/http/api-exception';
import { AuditService } from '../../common/audit/audit.service';
import { SettingsService } from '../../common/settings/settings.service';
import { AdminUsersService } from './admin-users.service';

const SETTINGS_LOCK = 'tezfiks:admin:platform-settings';

type SettingsResponse = EndpointOutput<typeof api.admin.settings>;

/** Platform settings for the Tənzimləmələr page: read (any admin), update (ADMIN role only, audited with before/after). */
@Injectable()
export class AdminSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly users: AdminUsersService,
  ) {}

  async get(): Promise<SettingsResponse> {
    return { settings: await this.settings.get(), defaults: this.settings.defaults(), demoMode: this.settings.demoMode };
  }

  async update(adminId: string, patch: Partial<PlatformSettings>, ip: string | null): Promise<SettingsResponse> {
    await this.users.requireAdminRole(adminId);
    const parsed = PlatformSettingsSchema.partial().safeParse(patch);
    if (!parsed.success) {
      throw new ApiException('VALIDATION_FAILED', { issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    }
    const keys = (Object.keys(parsed.data) as Array<keyof PlatformSettings>).filter((k) => parsed.data[k] !== undefined);
    if (!keys.length) return this.get();
    // The foundation's SettingsService.update reads, merges and writes without a lock. Admin saves are serialized here with a
    // transaction-scoped advisory lock, held while the read, the write and the audit row happen, so two admins saving
    // different keys at once both keep their change and the audit's before/after values are exact.
    await inTx(this.prisma, async (tx) => {
      await tx.$queryRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))::text AS locked`, SETTINGS_LOCK);
      this.settings.invalidate();
      const current = await this.settings.get();
      const before: Partial<Record<keyof PlatformSettings, unknown>> = {};
      for (const k of keys) before[k] = current[k];
      const next = await this.settings.update(parsed.data, adminId);
      const after: Partial<Record<keyof PlatformSettings, unknown>> = {};
      for (const k of keys) after[k] = next[k];
      await this.audit.log(
        { actorType: 'ADMIN', actorId: adminId, action: 'settings.update', entityType: 'PlatformSetting', entityId: 'platform', before, after, ip },
        tx,
      );
    });
    this.realtime.toAdmins('admin:event', { type: 'SETTINGS_UPDATED', entityId: 'platform' });
    return this.get();
  }
}
