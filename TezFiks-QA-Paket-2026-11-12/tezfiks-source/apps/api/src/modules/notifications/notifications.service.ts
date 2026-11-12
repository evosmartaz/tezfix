import { Injectable, Logger } from '@nestjs/common';
import type { NotificationType, NotificationView } from '@tezfiks/shared';
import { PrismaService } from '../../infra/prisma.service';
import { Clock } from '../../infra/clock';
import { RealtimeService } from '../../infra/realtime.service';
import { I18nService } from '../../common/i18n/i18n.service';
import { decodeCursor, encodeCursor, iso } from '../../common/mapping';
import type { Notification } from '../../generated/prisma/client';
import { PushService } from './push/push.service';
import type { PushChannelId, PushMessage, PushPriority } from './push/push.types';
import { sanitizeData, sanitizeVars } from './privacy';

export type NotifyApp = 'CUSTOMER' | 'PRO' | 'PANEL';

export interface NotifyOptions {
  /** Translation variables (see README.md for the vars each type uses). */
  vars?: Record<string, string | number>;
  /** Ids and amounts only; stored on the notification and sent in the push payload. */
  data?: Record<string, unknown>;
  /** Push only to devices of this app (the notification row and socket event are per user). */
  app?: NotifyApp;
  /** Default true. */
  push?: boolean;
  /** Default: 'high' for OFFER_NEW, otherwise 'normal'. */
  priority?: PushPriority;
  ttlSec?: number;
  collapseKey?: string;
  /** Default: 'offers_v1' for OFFER_NEW, otherwise 'default_v1'. */
  channelId?: PushChannelId;
}

const HIGH_PRIORITY_TYPES = new Set<NotificationType>(['OFFER_NEW']);
const OFFER_CHANNEL_TYPES = new Set<NotificationType>(['OFFER_NEW']);

export function toNotificationView(n: Notification): NotificationView {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    data: (n.data && typeof n.data === 'object' && !Array.isArray(n.data) ? n.data : {}) as Record<string, unknown>,
    readAt: iso(n.readAt),
    createdAt: n.createdAt.toISOString(),
  };
}

interface Cursor {
  c: string;
  i: string;
}

/** In-app notifications (DB row + `notification:new` socket event) and push to the user's devices. */
@Injectable()
export class NotificationsService {
  private readonly log = new Logger('Notifications');

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly realtime: RealtimeService,
    private readonly i18n: I18nService,
    private readonly push: PushService,
  ) {}

  private texts(locale: string, type: NotificationType, vars: Record<string, string | number>): { title: string; body: string } {
    let title = this.i18n.t(locale, `server.notifications.${type}.title`, vars).trim();
    const body = this.i18n.t(locale, `server.notifications.${type}.body`, vars).trim();
    if (!title) title = this.i18n.t(locale, 'server.notifications.appName');
    return { title, body };
  }

  /**
   * Notifies one user: creates the Notification row (title/body in the user's locale), emits `notification:new`
   * and pushes to the user's devices (filtered by `app`). Returns null for unknown or deleted users.
   * Push failures never throw.
   */
  async notify(userId: string, type: NotificationType, opts: NotifyOptions = {}): Promise<NotificationView | null> {
    const [view] = await this.notifyMany([userId], type, opts);
    return view ?? null;
  }

  /** Same as notify for several users (each in their own locale); one push batch. */
  async notifyMany(userIds: string[], type: NotificationType, opts: NotifyOptions = {}): Promise<NotificationView[]> {
    const ids = [...new Set(userIds.filter(Boolean))];
    if (!ids.length) return [];
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids }, status: { not: 'DELETED' } },
      select: { id: true, locale: true },
    });
    if (!users.length) return [];
    const vars = sanitizeVars(opts.vars);
    const data = sanitizeData(opts.data);
    const now = this.clock.now();
    const rows = await this.prisma.notification.createManyAndReturn({
      data: users.map((u) => ({ userId: u.id, type, ...this.texts(u.locale, type, vars), data: data as never, createdAt: now })),
    });
    const views = rows.map(toNotificationView);
    for (const v of views) {
      const row = rows.find((r) => r.id === v.id)!;
      this.realtime.toUser(row.userId, 'notification:new', v);
    }
    if (opts.push !== false) {
      const priority = opts.priority ?? (HIGH_PRIORITY_TYPES.has(type) ? 'high' : 'normal');
      const channelId = opts.channelId ?? (OFFER_CHANNEL_TYPES.has(type) ? 'offers_v1' : 'default_v1');
      // Group recipients by locale so every device gets text in its user's language.
      const byLocale = new Map<string, { userIds: string[]; row: Notification }>();
      for (const row of rows) {
        const locale = users.find((u) => u.id === row.userId)!.locale;
        const entry = byLocale.get(locale);
        if (entry) entry.userIds.push(row.userId);
        else byLocale.set(locale, { userIds: [row.userId], row });
      }
      for (const { userIds: group, row } of byLocale.values()) {
        const message: PushMessage = {
          type,
          title: row.title,
          body: row.body,
          data,
          priority,
          channelId,
          ...(opts.ttlSec !== undefined ? { ttlSec: opts.ttlSec } : {}),
          ...(opts.collapseKey ? { collapseKey: opts.collapseKey } : {}),
        };
        try {
          await this.push.sendToUsers(group, message, opts.app ? { app: opts.app } : {});
        } catch (err) {
          this.log.warn(`push for ${type} failed: ${(err as Error).message}`);
        }
      }
    }
    return views;
  }

  async list(userId: string, cursor: string | undefined, limit = 20): Promise<{ items: NotificationView[]; nextCursor: string | null }> {
    const c = decodeCursor<Cursor>(cursor);
    const after =
      c && typeof c.c === 'string' && typeof c.i === 'string' && !Number.isNaN(Date.parse(c.c))
        ? { OR: [{ createdAt: { lt: new Date(c.c) } }, { createdAt: new Date(c.c), id: { lt: c.i } }] }
        : {};
    const rows = await this.prisma.notification.findMany({
      where: { userId, ...after },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return {
      items: page.map(toNotificationView),
      nextCursor: hasMore && last ? encodeCursor({ c: last.createdAt.toISOString(), i: last.id } satisfies Cursor) : null,
    };
  }

  async unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, readAt: null } });
  }

  /** Marks the caller's notifications read (given ids, or all). Ids of other users are ignored. */
  async markRead(userId: string, input: { ids?: string[]; all?: boolean }): Promise<number> {
    if (!input.all && !input.ids?.length) return 0;
    const res = await this.prisma.notification.updateMany({
      where: { userId, readAt: null, ...(input.all ? {} : { id: { in: input.ids! } }) },
      data: { readAt: this.clock.now() },
    });
    return res.count;
  }
}
