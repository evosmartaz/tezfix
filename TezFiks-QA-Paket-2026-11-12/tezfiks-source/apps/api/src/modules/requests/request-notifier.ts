import { Injectable, Logger } from '@nestjs/common';
import { asLocale, type Locale, type NotificationType } from '@tezfiks/shared';
import { PrismaService } from '../../infra/prisma.service';
import { NotificationsService, type NotifyOptions } from '../notifications/notifications.service';

/**
 * Sends notifications whose variables depend on the recipient's language (category names, distances), grouping
 * recipients by locale. Always called after the transaction committed; failures are logged, never thrown.
 */
@Injectable()
export class RequestNotifier {
  private readonly log = new Logger('RequestNotifier');

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async send(
    userIds: Array<string | null | undefined>,
    type: NotificationType,
    vars: (locale: Locale) => Record<string, string | number>,
    opts: Omit<NotifyOptions, 'vars'> = {},
  ): Promise<void> {
    const ids = [...new Set(userIds.filter((v): v is string => !!v))];
    if (!ids.length) return;
    try {
      const users = await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, locale: true } });
      const byLocale = new Map<Locale, string[]>();
      for (const u of users) {
        const l = asLocale(u.locale);
        byLocale.set(l, [...(byLocale.get(l) ?? []), u.id]);
      }
      for (const [locale, group] of byLocale) {
        if (group.length === 1) await this.notifications.notify(group[0]!, type, { ...opts, vars: vars(locale) });
        else await this.notifications.notifyMany(group, type, { ...opts, vars: vars(locale) });
      }
    } catch (err) {
      this.log.warn(`notify ${type} failed: ${(err as Error).message}`);
    }
  }
}
