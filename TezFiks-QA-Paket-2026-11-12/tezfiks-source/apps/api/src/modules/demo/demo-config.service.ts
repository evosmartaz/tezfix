import { Inject, Injectable } from '@nestjs/common';
import { DemoConfigSchema, type DemoConfig } from '@tezfiks/shared';
import { ENV, type Env } from '../../config/env';
import { PrismaService } from '../../infra/prisma.service';
import { ApiException } from '../../common/http/api-exception';
import { DEFAULT_DEMO_CONFIG, DEMO_CONFIG_KEY } from './demo.constants';

/** Simulator configuration, stored in PlatformSetting `demo.config` (defaults from the plan). */
@Injectable()
export class DemoConfigService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  get enabled(): boolean {
    return this.env.DEMO_MODE;
  }

  /** Every demo endpoint answers DEMO_DISABLED unless the API runs with DEMO_MODE=true. */
  assertEnabled(): void {
    if (!this.env.DEMO_MODE) throw new ApiException('DEMO_DISABLED');
  }

  async get(): Promise<DemoConfig> {
    const row = await this.prisma.platformSetting.findUnique({ where: { key: DEMO_CONFIG_KEY } });
    const stored = DemoConfigSchema.partial().safeParse(row?.value ?? {});
    return { ...DEFAULT_DEMO_CONFIG, ...(stored.success ? stored.data : {}) };
  }

  /** Merges a partial config into the stored one; returns { before, after } for the audit log. */
  async update(patch: Partial<DemoConfig>, adminId: string | null): Promise<{ before: DemoConfig; after: DemoConfig }> {
    const valid = DemoConfigSchema.partial().parse(patch);
    // Money in the contract may be signed; a proposed price may not (the pro price endpoint takes amounts >= 0).
    for (const field of ['priceLabor', 'priceMaterials'] as const) {
      const v = valid[field];
      if (v !== undefined && v < 0) throw new ApiException('VALIDATION_FAILED', { in: 'body', field, min: 0 });
    }
    const before = await this.get();
    const after = DemoConfigSchema.parse({ ...before, ...valid });
    await this.prisma.platformSetting.upsert({
      where: { key: DEMO_CONFIG_KEY },
      create: { key: DEMO_CONFIG_KEY, value: after, updatedByAdminId: adminId },
      update: { value: after, updatedByAdminId: adminId },
    });
    return { before, after };
  }
}
