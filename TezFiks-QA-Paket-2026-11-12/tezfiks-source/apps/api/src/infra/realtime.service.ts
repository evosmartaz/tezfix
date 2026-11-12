import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';
import { rooms, type ServerToClientEvents } from '@tezfiks/shared';
import { ENV, type Env } from '../config/env';

export type ServerEvent = keyof ServerToClientEvents;
export type ServerEventPayload<E extends ServerEvent> = Parameters<ServerToClientEvents[E]>[0];

export interface SentEvent {
  room: string;
  event: ServerEvent;
  payload: unknown;
}

/**
 * Emits Socket.IO events to rooms. The gateway (RealtimeModule) attaches the server at startup;
 * before that, or in processes without a gateway, emits are dropped. In tests every emit is recorded in `sent`.
 */
@Injectable()
export class RealtimeService {
  private readonly log = new Logger('Realtime');
  private server?: Server;
  readonly sent: SentEvent[] = [];

  constructor(@Inject(ENV) private readonly env: Env) {}

  attach(server: Server): void {
    this.server = server;
  }

  get attached(): Server | undefined {
    return this.server;
  }

  toRoom<E extends ServerEvent>(room: string, event: E, payload: ServerEventPayload<E>): void {
    if (this.env.NODE_ENV === 'test') {
      this.sent.push({ room, event, payload });
      if (this.sent.length > 5000) this.sent.splice(0, 1000);
    }
    try {
      this.server?.to(room).emit(event, payload as never);
    } catch (err) {
      this.log.warn(`emit ${event} to ${room} failed: ${(err as Error).message}`);
    }
  }

  toUser<E extends ServerEvent>(userId: string, event: E, payload: ServerEventPayload<E>): void {
    this.toRoom(rooms.user(userId), event, payload);
  }

  toCompany<E extends ServerEvent>(companyId: string, event: E, payload: ServerEventPayload<E>): void {
    this.toRoom(rooms.company(companyId), event, payload);
  }

  toAssignment<E extends ServerEvent>(assignmentId: string, event: E, payload: ServerEventPayload<E>): void {
    this.toRoom(rooms.assignment(assignmentId), event, payload);
  }

  toRequest<E extends ServerEvent>(requestId: string, event: E, payload: ServerEventPayload<E>): void {
    this.toRoom(rooms.request(requestId), event, payload);
  }

  toAdmins<E extends ServerEvent>(event: E, payload: ServerEventPayload<E>): void {
    this.toRoom(rooms.admins(), event, payload);
  }

  /** Test helper: events sent to a room (optionally filtered by event name). */
  sentTo(room: string, event?: ServerEvent): SentEvent[] {
    return this.sent.filter((s) => s.room === room && (!event || s.event === event));
  }

  clearSent(): void {
    this.sent.length = 0;
  }
}
