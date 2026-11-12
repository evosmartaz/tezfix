import { z } from 'zod';
import { Id, IsoDateTime } from './contract/common';
import { AssignmentStatus, OfferCloseReason, PaymentPurpose, PaymentStatus, RequestStatus } from './enums';
import { OfferViewSchema, type OfferView } from './contract/domains/offers';
import { ChatMessageSchema, type ChatMessage } from './contract/domains/chat';
import { NotificationViewSchema, type NotificationView } from './contract/domains/notifications';
import { RequestSearchStateSchema } from './contract/domains/requests';
import { LocationBodySchema } from './contract/domains/pro';

/** Default Socket.IO path behind the reverse proxy. */
export const DEFAULT_SOCKET_PATH = '/tezfix/api/socket.io';

export const OfferClosedPayload = z.object({ offerId: Id, requestId: Id, reason: OfferCloseReason.schema });
export const RequestUpdatedPayload = z.object({ requestId: Id, status: RequestStatus.schema });
export const RequestSearchPayload = RequestSearchStateSchema.extend({ requestId: Id });
export const AssignmentUpdatedPayload = z.object({ assignmentId: Id, requestId: Id, status: AssignmentStatus.schema });
export const AssignmentLocationPayload = z.object({
  assignmentId: Id,
  lat: z.number(),
  lng: z.number(),
  heading: z.number().nullable(),
  at: IsoDateTime,
  etaSec: z.int().nullable(),
  distanceM: z.int().nullable(),
});
export const AssignmentContactPayload = z.object({ assignmentId: Id });
export const WalletUpdatedPayload = z.object({
  owner: z.enum(['customer', 'handyman', 'company']),
  companyId: Id.nullable(),
  available: z.int(),
  posted: z.int(),
});
export const CompanyWorkersPayload = z.object({ companyId: Id });
export const PaymentUpdatedPayload = z.object({ paymentIntentId: Id, status: PaymentStatus.schema, purpose: PaymentPurpose.schema });
export const AdminEventPayload = z.object({ type: z.string(), entityId: z.string().nullable() });
export const ProfileUpdatedPayload = z.object({ reason: z.string() });

export type OfferClosed = z.infer<typeof OfferClosedPayload>;
export type RequestUpdated = z.infer<typeof RequestUpdatedPayload>;
export type RequestSearch = z.infer<typeof RequestSearchPayload>;
export type AssignmentUpdated = z.infer<typeof AssignmentUpdatedPayload>;
export type AssignmentLocation = z.infer<typeof AssignmentLocationPayload>;
export type AssignmentContact = z.infer<typeof AssignmentContactPayload>;
export type WalletUpdated = z.infer<typeof WalletUpdatedPayload>;
export type CompanyWorkers = z.infer<typeof CompanyWorkersPayload>;
export type PaymentUpdated = z.infer<typeof PaymentUpdatedPayload>;
export type AdminEvent = z.infer<typeof AdminEventPayload>;
export type ProfileUpdated = z.infer<typeof ProfileUpdatedPayload>;

/** Server -> client events. Payloads are invalidation hints or small deltas; clients refetch details over REST. */
export interface ServerToClientEvents {
  'offer:new': (p: OfferView) => void;
  'offer:closed': (p: OfferClosed) => void;
  'request:updated': (p: RequestUpdated) => void;
  'request:search': (p: RequestSearch) => void;
  'assignment:updated': (p: AssignmentUpdated) => void;
  'assignment:location': (p: AssignmentLocation) => void;
  'assignment:contact': (p: AssignmentContact) => void;
  'chat:message': (p: ChatMessage) => void;
  'wallet:updated': (p: WalletUpdated) => void;
  'notification:new': (p: NotificationView) => void;
  'company:workers': (p: CompanyWorkers) => void;
  'payment:updated': (p: PaymentUpdated) => void;
  'profile:updated': (p: ProfileUpdated) => void;
  'admin:event': (p: AdminEvent) => void;
}

export const SocketAckSchema = z.object({ ok: z.boolean(), error: z.string().optional() });
export type SocketAck = z.infer<typeof SocketAckSchema>;

export const RoomJoinPayload = z.object({ room: z.enum(['assignment', 'request', 'company']), id: Id });
export type RoomJoin = z.infer<typeof RoomJoinPayload>;

export const ProLocationPayload = LocationBodySchema.extend({ assignmentId: Id.optional() });
export type ProLocation = z.infer<typeof ProLocationPayload>;

/** Client -> server events. */
export interface ClientToServerEvents {
  'pro:location': (p: ProLocation, ack?: (r: SocketAck) => void) => void;
  'pro:heartbeat': (p: Record<string, never>, ack?: (r: SocketAck) => void) => void;
  'room:join': (p: RoomJoin, ack?: (r: SocketAck) => void) => void;
  'room:leave': (p: RoomJoin, ack?: (r: SocketAck) => void) => void;
}

/** Room naming shared by the gateway and tests. */
export const rooms = {
  user: (userId: string) => `user:${userId}`,
  company: (companyId: string) => `company:${companyId}`,
  assignment: (id: string) => `assignment:${id}`,
  request: (id: string) => `request:${id}`,
  admins: () => 'admins',
};

export const SocketPayloadSchemas = {
  'offer:new': OfferViewSchema,
  'offer:closed': OfferClosedPayload,
  'request:updated': RequestUpdatedPayload,
  'request:search': RequestSearchPayload,
  'assignment:updated': AssignmentUpdatedPayload,
  'assignment:location': AssignmentLocationPayload,
  'assignment:contact': AssignmentContactPayload,
  'chat:message': ChatMessageSchema,
  'wallet:updated': WalletUpdatedPayload,
  'notification:new': NotificationViewSchema,
  'company:workers': CompanyWorkersPayload,
  'payment:updated': PaymentUpdatedPayload,
  'profile:updated': ProfileUpdatedPayload,
  'admin:event': AdminEventPayload,
} as const;
