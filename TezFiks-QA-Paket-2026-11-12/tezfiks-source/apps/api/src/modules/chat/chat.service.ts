import { Injectable, Logger } from '@nestjs/common';
import { isContactWindowOpen, type ChatMessage } from '@tezfiks/shared';
import { PrismaService } from '../../infra/prisma.service';
import { Clock } from '../../infra/clock';
import { RealtimeService } from '../../infra/realtime.service';
import { RateLimiter } from '../../infra/rate-limiter';
import { SettingsService } from '../../common/settings/settings.service';
import { ApiException } from '../../common/http/api-exception';
import { iso } from '../../common/mapping';
import { RequestNotifier } from '../requests/request-notifier';
import { AssignmentAccess, type AssignmentParties } from '../assignments/assignment-access.service';
import { fullName, isUuid, shortName } from '../assignments/assignments.constants';
import type { Assignment, ChatMessage as ChatRow } from '../../generated/prisma/client';

type Side = 'CUSTOMER' | 'PROVIDER';

/**
 * Assignment chat (spec 4.4): participants are the customer, the assigned handyman and active managers of the provider company.
 * Sending needs the contact window (unlocked, until chatOpenAfterTerminalMin after the job ended): CHAT_LOCKED otherwise.
 * Messages go to the assignment room and the other participants' user rooms; the CHAT_MESSAGE notification never carries the text.
 */
@Injectable()
export class ChatService {
  private readonly log = new Logger('Chat');

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly realtime: RealtimeService,
    private readonly rateLimiter: RateLimiter,
    private readonly settings: SettingsService,
    private readonly notifier: RequestNotifier,
    private readonly access: AssignmentAccess,
  ) {}

  /**
   * The caller's side, NOT_FOUND for anyone who is not a party, FORBIDDEN for the assigned worker of a company job: workers
   * see only the location and the customer's name/photo and contact their manager (spec 4.4), the managers chat for the
   * company. A worker who is also an active manager of that company chats as a manager.
   */
  private async participant(userId: string, assignmentId: string): Promise<{ a: Assignment; side: Side; p: AssignmentParties }> {
    const a = await this.access.load(assignmentId);
    const p = await this.access.parties(a);
    if (p.customerUserId === userId || p.creatorUserId === userId) return { a, side: 'CUSTOMER', p };
    if (p.managerUserIds.includes(userId)) return { a, side: 'PROVIDER', p };
    if (p.providerUserId === userId) {
      if (a.companyId) throw new ApiException('FORBIDDEN', { reason: 'WORKER_CONTACTS_MANAGER' });
      return { a, side: 'PROVIDER', p };
    }
    throw new ApiException('NOT_FOUND', { entity: 'assignment', id: assignmentId });
  }

  /** Provider-side chat participants: the solo handyman, or the active managers of a company job (never its worker). */
  private providerSide(a: Pick<Assignment, 'companyId'>, p: AssignmentParties): string[] {
    return a.companyId ? [...p.managerUserIds] : [p.providerUserId];
  }

  private async names(rows: ChatRow[]): Promise<Map<string, string>> {
    const ids = [...new Set(rows.map((r) => r.senderUserId))];
    const users = ids.length
      ? await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true } })
      : [];
    const out = new Map<string, string>();
    for (const r of rows) {
      const u = users.find((x) => x.id === r.senderUserId);
      // The customer is shown to providers as "Nizami T."; providers by their full name.
      out.set(r.id, r.senderSide === 'CUSTOMER' ? shortName(u?.firstName, u?.lastName) : fullName(u?.firstName, u?.lastName));
    }
    return out;
  }

  private view(r: ChatRow, senderName: string): ChatMessage {
    return {
      id: r.id,
      assignmentId: r.assignmentId,
      senderSide: r.senderSide,
      senderUserId: r.senderUserId,
      senderName,
      body: r.body,
      createdAt: iso(r.createdAt),
      readAt: iso(r.readAt),
    };
  }

  async list(userId: string, assignmentId: string, q: { cursor?: string; limit?: number }): Promise<{ items: ChatMessage[]; nextCursor: string | null }> {
    await this.participant(userId, assignmentId);
    if (q.cursor !== undefined && !isUuid(q.cursor)) throw new ApiException('VALIDATION_FAILED', { in: 'query', field: 'cursor' });
    const limit = Math.min(Math.max(q.limit ?? 30, 1), 100);
    const rows = await this.prisma.chatMessage.findMany({
      where: { assignmentId, ...(q.cursor ? { id: { lt: q.cursor } } : {}) },
      orderBy: { id: 'desc' },
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const slice = hasMore ? rows.slice(0, limit) : rows;
    const names = await this.names(slice);
    return { items: slice.map((r) => this.view(r, names.get(r.id) ?? '')), nextCursor: hasMore ? slice[slice.length - 1]!.id : null };
  }

  async send(userId: string, assignmentId: string, body: string): Promise<ChatMessage> {
    const { a, side, p } = await this.participant(userId, assignmentId);
    const s = await this.settings.get();
    const now = this.clock.now();
    if (!isContactWindowOpen({ contactUnlockedAt: a.contactUnlockedAt, endedAt: a.endedAt }, s, now))
      throw new ApiException('CHAT_LOCKED', { contactUnlocked: a.contactUnlockedAt != null, ended: a.endedAt != null });
    await this.rateLimiter.enforce(`chat:${userId}`, 30, 60);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { status: true, firstName: true, lastName: true } });
    if (user.status !== 'ACTIVE') throw new ApiException(user.status === 'BLOCKED' ? 'USER_BLOCKED' : 'FORBIDDEN');
    const row = await this.prisma.chatMessage.create({
      data: { assignmentId, senderUserId: userId, senderSide: side, body: body.trim(), createdAt: now },
    });
    const name = side === 'CUSTOMER' ? shortName(user.firstName, user.lastName) : fullName(user.firstName, user.lastName);
    const msg = this.view(row, name);
    // The worker of a company job is in the assignment room (live tracking), so company chat goes to user rooms only.
    if (!a.companyId) this.realtime.toAssignment(assignmentId, 'chat:message', msg);
    const providerSide = this.providerSide(a, p);
    const others = (side === 'CUSTOMER' ? providerSide : [p.customerUserId, ...providerSide]).filter((u) => u !== userId);
    for (const u of new Set(others)) this.realtime.toUser(u, 'chat:message', msg);
    try {
      // Push/notification: the sender's name and ids only, never the message text (spec 4.4, 11).
      const recipients = side === 'CUSTOMER' ? providerSide : [p.customerUserId];
      await this.notifier.send(
        recipients.filter((u) => u !== userId),
        'CHAT_MESSAGE',
        () => ({ name }),
        { app: side === 'CUSTOMER' ? 'PRO' : 'CUSTOMER', data: { assignmentId, messageId: row.id }, collapseKey: `chat-${assignmentId}` },
      );
    } catch (err) {
      this.log.warn(`chat notification failed: ${(err as Error).message}`);
    }
    return msg;
  }

  /** Marks the other side's messages read. */
  async markRead(userId: string, assignmentId: string): Promise<{ ok: true }> {
    const { side } = await this.participant(userId, assignmentId);
    await this.prisma.chatMessage.updateMany({
      where: { assignmentId, readAt: null, senderSide: side === 'CUSTOMER' ? 'PROVIDER' : 'CUSTOMER' },
      data: { readAt: this.clock.now() },
    });
    return { ok: true };
  }
}
