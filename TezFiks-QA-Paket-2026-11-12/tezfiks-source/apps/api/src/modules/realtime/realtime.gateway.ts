import { Logger, type OnModuleInit } from '@nestjs/common';
import { WebSocketGateway, type OnGatewayInit } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import {
  DEFAULT_SOCKET_PATH,
  ProLocationPayload,
  RoomJoinPayload,
  rooms,
  type ClientToServerEvents,
  type ServerToClientEvents,
  type SocketAck,
} from '@tezfiks/shared';
import { RealtimeService } from '../../infra/realtime.service';
import { PrismaService } from '../../infra/prisma.service';
import { DomainEvents } from '../../infra/events';
import { ReconcilerService } from '../../infra/reconciler.service';
import { TokenService } from '../../common/auth/token.service';
import { SessionsService } from '../../common/auth/sessions.service';
import type { Principal } from '../../common/auth/types';
import { PresenceService } from './presence.service';
import { RoomAccessService } from './room-access.service';

interface SocketData {
  principal: Principal;
  initialRooms: string[];
  handymanId?: string;
}

type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type AppServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type Ack = ((r: SocketAck) => void) | undefined;

const UNAUTHORIZED = 'UNAUTHORIZED';

function reply(ack: Ack, r: SocketAck): void {
  if (typeof ack === 'function') {
    try {
      ack(r);
    } catch {
      /* client went away */
    }
  }
}

/**
 * Socket.IO gateway. Handshake auth: `auth.token` (JWT access token) or `auth.ticket` (single-use panel ticket).
 * On connect the socket joins user:<id>, company:<id> (active manager memberships) or `admins`.
 */
@WebSocketGateway({
  path: process.env.SOCKET_PATH ?? DEFAULT_SOCKET_PATH,
  cors: { origin: true },
  transports: ['websocket', 'polling'],
})
export class RealtimeGateway implements OnGatewayInit, OnModuleInit {
  private readonly log = new Logger('RealtimeGateway');

  constructor(
    private readonly realtime: RealtimeService,
    private readonly tokens: TokenService,
    private readonly sessions: SessionsService,
    private readonly prisma: PrismaService,
    private readonly presence: PresenceService,
    private readonly access: RoomAccessService,
    private readonly events: DomainEvents,
    private readonly reconciler: ReconcilerService,
  ) {}

  onModuleInit(): void {
    // Blocked users lose their live sockets at once.
    this.events.on('user.blocked', ({ userId }) => {
      this.realtime.attached?.in(rooms.user(userId)).disconnectSockets(true);
    });
    // Safety net for state that changes after the handshake: revoked sessions and lost company memberships.
    this.reconciler.register('realtime.sweep', async () => {
      await this.sweep();
    });
  }

  /**
   * Re-validates every live socket: sockets whose session was revoked (logout, account deletion, admin revoke) or whose user
   * was blocked are disconnected; company/assignment rooms a user may no longer join are left and new manager company rooms
   * are joined (RoomAccessService.refreshUser). Runs on every reconciler tick; never throws.
   */
  async sweep(): Promise<{ disconnected: number; left: number; joined: number }> {
    const out = { disconnected: 0, left: 0, joined: 0 };
    const server = this.realtime.attached;
    if (!server) return out;
    const users = new Set<string>();
    for (const raw of [...server.of('/').sockets.values()]) {
      const socket = raw as unknown as AppSocket;
      const p = socket.data?.principal;
      if (!p || !(await this.sessionValid(p))) {
        socket.disconnect(true);
        out.disconnected++;
        continue;
      }
      if (p.kind === 'user') users.add(p.userId);
    }
    for (const userId of users) {
      const r = await this.access.refreshUser(userId);
      out.left += r.left;
      out.joined += r.joined;
    }
    return out;
  }

  private async sessionValid(p: Principal): Promise<boolean> {
    try {
      await this.sessions.validate(p);
      return true;
    } catch {
      return false;
    }
  }

  /** Every client event re-checks the session (cached by SessionsService): a revoked socket is answered UNAUTHORIZED and dropped. */
  private async guard(socket: AppSocket, ack: Ack): Promise<boolean> {
    if (await this.sessionValid(socket.data.principal)) return true;
    reply(ack, { ok: false, error: UNAUTHORIZED });
    socket.disconnect(true);
    return false;
  }

  afterInit(server: AppServer): void {
    this.realtime.attach(server as unknown as Server);
    server.use((socket, next) => {
      this.authenticate(socket as AppSocket)
        .then(() => next())
        .catch(() => next(new Error(UNAUTHORIZED)));
    });
    server.on('connection', (socket) => this.onConnection(socket as AppSocket));
  }

  /** Resolves the principal (token or ticket), validates the session and precomputes the rooms to join. */
  async authenticate(socket: AppSocket): Promise<void> {
    const auth = (socket.handshake.auth ?? {}) as { token?: unknown; ticket?: unknown };
    let principal: Principal | null = null;
    if (typeof auth.token === 'string' && auth.token) {
      principal = this.tokens.verifyAccess(auth.token);
    } else if (typeof auth.ticket === 'string' && auth.ticket) {
      principal = await this.tokens.consumeRealtimeTicket(auth.ticket);
    }
    if (!principal) throw new Error(UNAUTHORIZED);
    await this.sessions.validate(principal);
    socket.data.principal = principal;
    socket.data.initialRooms = await this.access.initialRooms(principal);
  }

  private onConnection(socket: AppSocket): void {
    const data = socket.data;
    if (!data?.principal) {
      socket.disconnect(true);
      return;
    }
    void socket.join(data.initialRooms);

    socket.on('room:join', (payload, ack) => {
      void this.handleRoom(socket, payload, ack, 'join');
    });
    socket.on('room:leave', (payload, ack) => {
      void this.handleRoom(socket, payload, ack, 'leave');
    });
    socket.on('pro:location', (payload, ack) => {
      void this.handleLocation(socket, payload, ack);
    });
    socket.on('pro:heartbeat', (_payload, ack) => {
      void this.handleHeartbeat(socket, typeof _payload === 'function' ? (_payload as Ack) : ack);
    });
  }

  private async handleRoom(socket: AppSocket, payload: unknown, ack: Ack, mode: 'join' | 'leave'): Promise<void> {
    try {
      if (!(await this.guard(socket, ack))) return;
      const parsed = RoomJoinPayload.safeParse(payload);
      if (!parsed.success) return reply(ack, { ok: false, error: 'VALIDATION_FAILED' });
      const room = this.access.roomName(parsed.data);
      if (mode === 'leave') {
        if (!socket.data.initialRooms.includes(room)) await socket.leave(room);
        return reply(ack, { ok: true });
      }
      if (!(await this.access.canJoin(socket.data.principal, parsed.data))) return reply(ack, { ok: false, error: 'FORBIDDEN' });
      await socket.join(room);
      reply(ack, { ok: true });
    } catch (err) {
      this.log.warn(`room:${mode} failed: ${(err as Error).message}`);
      reply(ack, { ok: false, error: 'INTERNAL' });
    }
  }

  /** The caller's handyman profile id (cached once found). */
  private async handymanId(socket: AppSocket): Promise<string | null> {
    if (socket.data.handymanId) return socket.data.handymanId;
    const p = socket.data.principal;
    if (p.kind !== 'user') return null;
    const profile = await this.prisma.handymanProfile.findUnique({ where: { userId: p.userId }, select: { id: true } });
    if (profile) socket.data.handymanId = profile.id;
    return profile?.id ?? null;
  }

  private async handleLocation(socket: AppSocket, payload: unknown, ack: Ack): Promise<void> {
    try {
      if (!(await this.guard(socket, ack))) return;
      const parsed = ProLocationPayload.safeParse(payload);
      if (!parsed.success) return reply(ack, { ok: false, error: 'VALIDATION_FAILED' });
      const handymanId = await this.handymanId(socket);
      if (!handymanId) return reply(ack, { ok: false, error: 'FORBIDDEN' });
      const event = await this.presence.updateLocation(handymanId, parsed.data);
      reply(ack, event ? { ok: true } : { ok: false, error: 'NOT_FOUND' });
    } catch (err) {
      this.log.warn(`pro:location failed: ${(err as Error).message}`);
      reply(ack, { ok: false, error: 'INTERNAL' });
    }
  }

  private async handleHeartbeat(socket: AppSocket, ack: Ack): Promise<void> {
    try {
      if (!(await this.guard(socket, ack))) return;
      const handymanId = await this.handymanId(socket);
      if (!handymanId) return reply(ack, { ok: false, error: 'FORBIDDEN' });
      await this.presence.touch(handymanId);
      reply(ack, { ok: true });
    } catch (err) {
      this.log.warn(`pro:heartbeat failed: ${(err as Error).message}`);
      reply(ack, { ok: false, error: 'INTERNAL' });
    }
  }
}
