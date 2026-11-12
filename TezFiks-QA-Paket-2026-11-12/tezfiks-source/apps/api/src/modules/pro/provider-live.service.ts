import { Injectable, Logger } from '@nestjs/common';
import { rooms, type AppKind } from '@tezfiks/shared';
import { PrismaService } from '../../infra/prisma.service';
import { RealtimeService } from '../../infra/realtime.service';
import { SessionsService } from '../../common/auth/sessions.service';
import type { Principal } from '../../common/auth/types';
import { PresenceService } from '../realtime/presence.service';
import { RoomAccessService } from '../realtime/room-access.service';

/**
 * Live effects of provider state changes: taking handymen offline (DB first, then presence, as lane A3 requires) and
 * revoking sessions + dropping the matching live sockets when an admin blocks a user, handyman or company.
 * The `realtime.sweep` reconciler task is only the safety net.
 */
@Injectable()
export class ProviderLiveService {
  private readonly log = new Logger('ProviderLive');

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly sessions: SessionsService,
    private readonly presence: PresenceService,
    private readonly roomAccess: RoomAccessService,
  ) {}

  /** Commits isOnline=false for the handymen, then removes them from the presence store. */
  async forceOffline(handymanIds: string[]): Promise<void> {
    if (!handymanIds.length) return;
    await this.prisma.handymanProfile.updateMany({ where: { id: { in: handymanIds }, isOnline: true }, data: { isOnline: false } });
    for (const id of handymanIds) await this.presence.setOffline(id);
  }

  /**
   * Revokes the users' unrevoked sessions of the given apps (all apps when `apps` is omitted), disconnects the live
   * sockets bound to those sessions and re-syncs the users' remaining sockets. Returns the number of revoked sessions.
   */
  async kickSessions(userIds: string[], reason: string, apps?: AppKind[]): Promise<number> {
    if (!userIds.length) return 0;
    const sessions = await this.prisma.session.findMany({
      where: { userId: { in: userIds }, revokedAt: null, ...(apps ? { app: { in: apps } } : {}) },
      select: { id: true },
    });
    for (const s of sessions) await this.sessions.revoke(s.id, reason);
    const revoked = new Set(sessions.map((s) => s.id));
    await this.disconnect(userIds, (p) => p.kind === 'user' && revoked.has(p.sessionId));
    for (const userId of userIds) await this.roomAccess.refreshUser(userId);
    return sessions.length;
  }

  /** Disconnects the users' live sockets whose principal matches `match` (never throws). */
  async disconnect(userIds: string[], match: (p: Principal) => boolean): Promise<number> {
    const server = this.realtime.attached;
    if (!server) return 0;
    let n = 0;
    for (const userId of userIds) {
      try {
        const sockets = await server.in(rooms.user(userId)).fetchSockets();
        for (const s of sockets) {
          const p = (s.data as { principal?: Principal } | undefined)?.principal;
          if (p && match(p)) {
            s.disconnect(true);
            n++;
          }
        }
      } catch (err) {
        this.log.warn(`disconnect(${userId}) failed: ${(err as Error).message}`);
      }
    }
    return n;
  }

  /** Re-syncs live socket rooms of the users after a membership change. */
  async refreshUsers(userIds: string[]): Promise<void> {
    for (const userId of new Set(userIds)) await this.roomAccess.refreshUser(userId);
  }
}
