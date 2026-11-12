import { Inject, Injectable } from '@nestjs/common';
import { DEFAULT_SETTINGS, PlatformSettingsSchema, resolveSettings, type PlatformSettings } from '@tezfiks/shared';
import { ENV, type Env } from '../../config/env';
import { PrismaService } from '../../infra/prisma.service';

const KEY = 'platform';
const CACHE_MS = 3000;

/** Platform settings (fees, timers): defaults <- demo overrides <- values saved by admins. */
@Injectable()
export class SettingsService {
  private cached?: { value: PlatformSettings; until: number };

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  get demoMode(): boolean {
    return this.env.DEMO_MODE;
  }

  async get(): Promise<PlatformSettings> {
    if (this.cached && this.cached.until > Date.now()) return this.cached.value;
    const row = await this.prisma.platformSetting.findUnique({ where: { key: KEY } });
    const stored = PlatformSettingsSchema.partial().safeParse(row?.value ?? {});
    const value = resolveSettings(stored.success ? stored.data : {}, this.env.DEMO_MODE);
    this.cached = { value, until: Date.now() + CACHE_MS };
    return value;
  }

  /** Effective defaults (before admin changes) for the settings screen. */
  defaults(): PlatformSettings {
    return resolveSettings({}, this.env.DEMO_MODE);
  }

  async stored(): Promise<Partial<PlatformSettings>> {
    const row = await this.prisma.platformSetting.findUnique({ where: { key: KEY } });
    const stored = PlatformSettingsSchema.partial().safeParse(row?.value ?? {});
    return stored.success ? stored.data : {};
  }

  async update(patch: Partial<PlatformSettings>, adminId: string | null): Promise<PlatformSettings> {
    const valid = PlatformSettingsSchema.partial().parse(patch);
    const next = { ...(await this.stored()), ...valid };
    await this.prisma.platformSetting.upsert({
      where: { key: KEY },
      create: { key: KEY, value: next, updatedByAdminId: adminId },
      update: { value: next, updatedByAdminId: adminId },
    });
    this.invalidate();
    return this.get();
  }

  /** Tests: replace stored settings entirely. */
  async replace(values: Partial<PlatformSettings>): Promise<void> {
    await this.prisma.platformSetting.upsert({
      where: { key: KEY },
      create: { key: KEY, value: values },
      update: { value: values },
    });
    this.invalidate();
  }

  invalidate(): void {
    this.cached = undefined;
  }
}

export { DEFAULT_SETTINGS };
