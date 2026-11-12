import { z } from 'zod';
import { endpoint } from '../define';
import { Id, IsoDateTime, Ok, PageQuery, paginated } from '../common';
import { NotificationType } from '../../enums';

export const NotificationViewSchema = z.object({
  id: Id,
  type: NotificationType.schema,
  title: z.string(),
  body: z.string(),
  data: z.record(z.string(), z.unknown()),
  readAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
});
export type NotificationView = z.infer<typeof NotificationViewSchema>;

export const notificationsEndpoints = {
  list: endpoint({
    method: 'GET',
    path: '/notifications',
    auth: 'user',
    query: PageQuery,
    response: paginated(NotificationViewSchema),
  }),
  unreadCount: endpoint({
    method: 'GET',
    path: '/notifications/unread-count',
    auth: 'user',
    response: z.object({ count: z.int() }),
  }),
  markRead: endpoint({
    method: 'POST',
    path: '/notifications/read',
    auth: 'user',
    body: z.object({ ids: z.array(Id).max(200).optional(), all: z.boolean().optional() }),
    response: Ok,
  }),
};
