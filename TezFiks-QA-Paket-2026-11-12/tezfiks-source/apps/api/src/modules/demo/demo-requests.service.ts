import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { CreateRequestBodySchema, type Locale, type RequestTiming } from '@tezfiks/shared';
import { PrismaService } from '../../infra/prisma.service';
import { Clock } from '../../infra/clock';
import { AuditService } from '../../common/audit/audit.service';
import { I18nService } from '../../common/i18n/i18n.service';
import { ApiException } from '../../common/http/api-exception';
import { LedgerService } from '../ledger/ledger.service';
import { CustomerService } from '../customer/customer.service';
import { GeoService } from '../geo/geo.service';
import { RequestsService } from '../requests/requests.service';
import { DEMO_CUSTOMER, DEMO_CUSTOMER_MIN_BALANCE, DEMO_CUSTOMER_TOPUP } from './demo.constants';

export interface DemoRequestInput {
  customerUserId?: string;
  categoryId: string;
  lat: number;
  lng: number;
  timing?: RequestTiming;
  slots?: number;
  scheduledAt?: string;
  description?: string;
}

/**
 * The demo customer and test requests (admin "Demo" page: a request at a chosen point, so the pro app can be tried alone).
 * Requests are created through the real RequestsService.create (dispatch, fees and notifications as for a customer).
 */
@Injectable()
export class DemoRequestsService {
  private readonly log = new Logger('DemoRequests');

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly i18n: I18nService,
    private readonly ledger: LedgerService,
    private readonly customers: CustomerService,
    private readonly geo: GeoService,
  ) {}

  /** RequestsService is not exported by RequestsModule; it is stateless, so the app-wide instance is used. */
  private get requests(): RequestsService {
    return this.moduleRef.get(RequestsService, { strict: false });
  }

  /**
   * The "Demo Müştəri" user (fixed phone, see docs/demo.md) with an individual customer account whose wallet always holds
   * at least DEMO_CUSTOMER_MIN_BALANCE (test top-ups through the ledger, idempotent per wallet state).
   */
  async ensureDemoCustomer(): Promise<{ userId: string; accountId: string; walletAccountId: string }> {
    let user = await this.prisma.user.findUnique({ where: { phone: DEMO_CUSTOMER.phone } });
    if (!user) {
      try {
        user = await this.prisma.user.create({
          data: { phone: DEMO_CUSTOMER.phone, firstName: DEMO_CUSTOMER.firstName, lastName: DEMO_CUSTOMER.lastName, createdAt: this.clock.now() },
        });
      } catch (err) {
        if ((err as { code?: string }).code !== 'P2002') throw err;
        user = await this.prisma.user.findUniqueOrThrow({ where: { phone: DEMO_CUSTOMER.phone } });
      }
    }
    if (user.status !== 'ACTIVE') throw new ApiException('INVALID_STATE', { reason: 'DEMO_CUSTOMER_INACTIVE', status: user.status });
    let account = await this.customers.findAccount(user.id);
    if (!account) {
      await this.customers.upsertAccount(user.id, { type: 'INDIVIDUAL' });
      account = await this.customers.requireAccount(user.id);
    }
    await this.topUpIfLow(account.walletAccountId);
    return { userId: user.id, accountId: account.id, walletAccountId: account.walletAccountId };
  }

  private async topUpIfLow(walletAccountId: string): Promise<void> {
    const bal = await this.ledger.balance(walletAccountId);
    if (bal.available >= DEMO_CUSTOMER_MIN_BALANCE && bal.posted >= 0) return;
    // Two concurrent callers see the same number of postings and so the same key: only one top-up is posted.
    const postings = await this.prisma.ledgerEntry.count({ where: { accountId: walletAccountId } });
    const amount = DEMO_CUSTOMER_TOPUP + Math.max(0, -bal.posted);
    const external = await this.ledger.platformAccountId('EXTERNAL');
    await this.ledger.post({
      kind: 'TOPUP',
      idempotencyKey: `demo-customer-topup:${walletAccountId}:${postings}`,
      entries: [
        { accountId: external, amount: -amount },
        { accountId: walletAccountId, amount },
      ],
      memo: 'demo customer top-up',
      actor: { type: 'SYSTEM' },
      metadata: { demo: true },
    });
  }

  /** api.admin.demoCreateRequest: a request at a point, as the demo customer or `customerUserId`. */
  async create(adminId: string | null, body: DemoRequestInput, ip: string | null): Promise<{ requestId: string; number: number }> {
    let userId: string;
    if (body.customerUserId) {
      const u = await this.prisma.user.findUnique({ where: { id: body.customerUserId }, select: { id: true } });
      if (!u) throw new ApiException('NOT_FOUND', { entity: 'user', id: body.customerUserId });
      userId = u.id;
    } else {
      userId = (await this.ensureDemoCustomer()).userId;
    }
    const owner = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { locale: true } });
    const customerLocale = owner.locale as Locale;
    let address: { formatted: string; district?: string; street?: string; building?: string; placeId?: string };
    try {
      const g = await this.geo.reverse(body.lat, body.lng, customerLocale);
      address = {
        formatted: g.formatted.trim().slice(0, 300) || `${body.lat.toFixed(5)}, ${body.lng.toFixed(5)}`,
        ...(g.district ? { district: g.district.slice(0, 80) } : {}),
        ...(g.street ? { street: g.street.slice(0, 120) } : {}),
        ...(g.building ? { building: g.building.slice(0, 40) } : {}),
        ...(g.placeId ? { placeId: g.placeId.slice(0, 300) } : {}),
      };
    } catch (err) {
      this.log.warn(`reverse geocode failed: ${(err as Error).message}`);
      address = { formatted: `${body.lat.toFixed(5)}, ${body.lng.toFixed(5)}` };
    }
    const parsed = CreateRequestBodySchema.safeParse({
      categoryId: body.categoryId,
      description: body.description?.trim() || this.i18n.t(customerLocale, 'server.demo.requestDescription'),
      timing: body.timing ?? 'NOW',
      scheduledAt: body.scheduledAt,
      slots: body.slots ?? 1,
      address: { lat: body.lat, lng: body.lng, ...address },
    });
    if (!parsed.success) {
      throw new ApiException('VALIDATION_FAILED', {
        in: 'body',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const detail = await this.requests.create(userId, parsed.data, customerLocale);
    await this.audit.log({
      actorType: adminId ? 'ADMIN' : 'SYSTEM',
      actorId: adminId,
      action: 'demo.createRequest',
      entityType: 'ServiceRequest',
      entityId: detail.id,
      after: { number: detail.number, customerUserId: userId, categoryId: body.categoryId, timing: parsed.data.timing, slots: parsed.data.slots },
      ip,
    });
    return { requestId: detail.id, number: detail.number };
  }
}
