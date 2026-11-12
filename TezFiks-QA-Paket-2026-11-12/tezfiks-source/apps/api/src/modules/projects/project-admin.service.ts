import { Injectable } from '@nestjs/common';
import { DEFAULT_LOCALE, formatMoney, type InvoiceView, type Locale, type ProjectStatus } from '@tezfiks/shared';
import { PrismaService, inTx } from '../../infra/prisma.service';
import { Clock } from '../../infra/clock';
import { RealtimeService } from '../../infra/realtime.service';
import { SettingsService } from '../../common/settings/settings.service';
import { I18nService } from '../../common/i18n/i18n.service';
import { AuditService } from '../../common/audit/audit.service';
import { ApiException } from '../../common/http/api-exception';
import { iso, num } from '../../common/mapping';
import { LedgerService } from '../ledger/ledger.service';
import { WalletEventsService } from '../wallet/wallet-events.service';
import { ProjectViews } from './project-views.service';
import { ProjectNotifier } from './project-notifier';
import { ProviderActorService } from './provider-actor.service';
import { lockProjectRow } from './project-locks';

const UUID_RE = /^[0-9a-f-]{36}$/i;

function cursorOf(cursor: string | undefined): string | null {
  if (!cursor) return null;
  if (!UUID_RE.test(cursor)) throw new ApiException('VALIDATION_FAILED', { field: 'cursor' });
  return cursor;
}

/** Admin side of B2B: project list / detail, invoice list, "mark invoice paid" (bank transfer received, demo). */
@Injectable()
export class ProjectAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly realtime: RealtimeService,
    private readonly settings: SettingsService,
    private readonly i18n: I18nService,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
    private readonly walletEvents: WalletEventsService,
    private readonly views: ProjectViews,
    private readonly notifier: ProjectNotifier,
    private readonly actors: ProviderActorService,
  ) {}

  async projects(q: { cursor?: string; limit?: number; status?: ProjectStatus }, locale: Locale) {
    const limit = q.limit ?? 20;
    const cursor = cursorOf(q.cursor);
    const rows = await this.views.loadMany(
      { ...(q.status ? { status: q.status } : {}), ...(cursor ? { id: { lt: cursor } } : {}) },
      { take: limit + 1, orderBy: [{ id: 'desc' }] },
    );
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return { items: page.map((p) => this.views.adminRow(p, locale)), nextCursor: hasMore ? page[page.length - 1]!.id : null };
  }

  async project(projectId: string, locale: Locale) {
    const p = await this.views.load(projectId);
    if (!p) throw new ApiException('NOT_FOUND', { entity: 'project', id: projectId });
    return this.views.adminDetail(p, locale);
  }

  async invoices(q: { cursor?: string; limit?: number }): Promise<{ items: InvoiceView[]; nextCursor: string | null }> {
    const limit = q.limit ?? 20;
    const cursor = cursorOf(q.cursor);
    const rows = await this.prisma.invoice.findMany({
      where: cursor ? { id: { lt: cursor } } : {},
      orderBy: { id: 'desc' },
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return { items: await this.views.invoiceViews(page), nextCursor: hasMore ? page[page.length - 1]!.id : null };
  }

  /**
   * Bank transfer received: posts INVOICE_PAYMENT (platform EXTERNAL -> provider EARNINGS, the invoice total, key
   * invoice-payment:<invoiceId>), marks the invoice PAID and the project PAID with guaranteeUntil = now + guaranteeDays. Audited.
   * Only ISSUED invoices (INVALID_STATE otherwise).
   */
  async markInvoicePaid(adminId: string, invoiceId: string, ip: string | null): Promise<InvoiceView> {
    const pre = await this.prisma.invoice.findUnique({ where: { id: invoiceId }, select: { projectId: true } });
    if (!pre) throw new ApiException('NOT_FOUND', { entity: 'invoice', id: invoiceId });
    const s = await this.settings.get();
    const out = await inTx(this.prisma, async (tx) => {
      await lockProjectRow(tx, pre.projectId);
      await tx.$queryRawUnsafe('SELECT id FROM invoices WHERE id = $1::uuid FOR UPDATE', invoiceId);
      const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
      if (inv.status !== 'ISSUED') throw new ApiException('INVALID_STATE', { status: inv.status });
      const p = await tx.project.findUniqueOrThrow({ where: { id: inv.projectId } });
      const ref = { providerType: inv.issuerType, handymanId: inv.handymanId, companyId: inv.companyId };
      const { earningsAccountId } = await this.actors.accountsOf(ref, tx);
      if (!earningsAccountId) throw new ApiException('INVALID_STATE', { reason: 'NO_EARNINGS_ACCOUNT' });
      const external = await this.ledger.platformAccountId('EXTERNAL', tx);
      const total = num(inv.total);
      const now = this.clock.now();
      const { transactionId } = await this.ledger.post(
        {
          kind: 'INVOICE_PAYMENT',
          idempotencyKey: `invoice-payment:${inv.id}`,
          entries: [
            { accountId: external, amount: -total },
            { accountId: earningsAccountId, amount: total },
          ],
          memo: this.i18n.t(DEFAULT_LOCALE, 'server.projects.memo.invoicePayment', { invoice: inv.number, number: p.number }),
          refs: { projectId: p.id, invoiceId: inv.id },
          actor: { type: 'ADMIN', id: adminId },
        },
        tx,
      );
      const paid = await tx.invoice.update({ where: { id: inv.id }, data: { status: 'PAID', paidAt: now, markedPaidByAdminId: adminId } });
      const guaranteeUntil = new Date(now.getTime() + s.guaranteeDays * 24 * 60 * 60_000);
      await tx.project.update({ where: { id: p.id }, data: { status: 'PAID', guaranteeUntil } });
      await this.audit.log(
        {
          actorType: 'ADMIN',
          actorId: adminId,
          action: 'invoice.markPaid',
          entityType: 'Invoice',
          entityId: inv.id,
          before: { status: inv.status, projectStatus: p.status },
          after: { status: 'PAID', projectStatus: 'PAID', paidAt: iso(now), total, transactionId, guaranteeUntil: iso(guaranteeUntil) },
          ip,
        },
        tx,
      );
      return { invoice: paid, project: p, ref, earningsAccountId };
    });
    const view = this.views.invoiceView(out.invoice, out.project.number);
    await this.walletEvents.notifyAccounts([out.earningsAccountId]);
    const providerUsers = await this.actors.userIdsOf(out.ref);
    await this.notifier.send(
      [...providerUsers, out.project.createdByUserId],
      'INVOICE_PAID',
      (l) => ({ number: view.number, amount: formatMoney(view.total, l) }),
      { data: { projectId: out.project.id, invoiceId: view.id } },
    );
    this.realtime.toAdmins('admin:event', { type: 'INVOICE_PAID', entityId: view.id });
    return view;
  }
}
