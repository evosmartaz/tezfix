import { z } from 'zod';
import { endpoint } from '../define';
import { Id, IdParams, IsoDateTime, Ok, PageQuery, paginated } from '../common';

export const ChatMessageSchema = z.object({
  id: Id,
  assignmentId: Id,
  senderSide: z.enum(['CUSTOMER', 'PROVIDER']),
  senderUserId: Id,
  senderName: z.string(),
  body: z.string(),
  createdAt: IsoDateTime,
  readAt: IsoDateTime.nullable(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const chatEndpoints = {
  list: endpoint({
    method: 'GET',
    path: '/assignments/:id/messages',
    auth: 'user',
    params: IdParams,
    query: PageQuery,
    response: paginated(ChatMessageSchema),
    summary: 'Newest first. Customer, assigned handyman or a manager of the provider company.',
  }),
  send: endpoint({
    method: 'POST',
    path: '/assignments/:id/messages',
    auth: 'user',
    params: IdParams,
    body: z.object({ body: z.string().trim().min(1).max(1000) }),
    response: ChatMessageSchema,
    summary: 'Fails with CHAT_LOCKED until the handyman is about 5 minutes away',
  }),
  markRead: endpoint({
    method: 'POST',
    path: '/assignments/:id/messages/read',
    auth: 'user',
    params: IdParams,
    response: Ok,
  }),
};
