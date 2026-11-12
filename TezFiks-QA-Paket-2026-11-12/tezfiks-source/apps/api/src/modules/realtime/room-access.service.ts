import { Injectable, Logger } from '@nestjs/common';
import { rooms, type RoomJoin } from '@tezfiks/shared';
import { PrismaService } from '../../infra/prisma.service';
import { RealtimeService } from '../../infra/realtime.service';
import type { Principal } from '../../common/auth/types';

/** The parts of a live socket that room syncing needs (works with socket.io Socket objects). */
interface LiveSocket {
  rooms: Set<string>;
  data: { principal?: Principal; initialRooms?: string[] } | undefined;
  join(room: string | string[]): unknown;
  leave(room: string): unknown;
}

/** Who may join which Socket.IO room, and which rooms a socket joins automatically on connect. */
@Injectable()
export class RoomAccessService {
  private readonly log = new Logger('RoomAccess');

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  /** user:<id>, company:<id> for every ACTIVE MANAGER membership, `admins` for admins. */
  async initialRooms(p: Principal): Promise<string[]> {
    if (p.kind === 'admin') return [rooms.admins()];
    const managed = await this.prisma.companyMember.findMany({
      where: { userId: p.userId, role: 'MANAGER', status: 'ACTIVE', company: { status: { not: 'BLOCKED' } } },
      select: { companyId: true },
    });
    return [rooms.user(p.userId), ...managed.map((m) => rooms.company(m.companyId))];
  }

  private async isActiveManager(userId: string, companyId: string): Promise<boolean> {
    const m = await this.prisma.companyMember.findUnique({
      where: { companyId_userId: { companyId, userId } },
      select: { role: true, status: true, company: { select: { status: true } } },
    });
    return !!m && m.role === 'MANAGER' && m.status === 'ACTIVE' && m.company.status !== 'BLOCKED';
  }

  /**
   * request → its customer (account owner or creator) or admin; assignment → its customer, its handyman, active managers
   * of its company, or admin; company → active manager or admin. Unknown entities are refused like foreign ones.
   */
  async canJoin(p: Principal, target: RoomJoin): Promise<boolean> {
    if (p.kind === 'admin') return true;
    const userId = p.userId;
    switch (target.room) {
      case 'company':
        return this.isActiveManager(userId, target.id);
      case 'request': {
        const r = await this.prisma.serviceRequest.findUnique({
          where: { id: target.id },
          select: { createdByUserId: true, customerAccount: { select: { ownerUserId: true } } },
        });
        return !!r && (r.customerAccount.ownerUserId === userId || r.createdByUserId === userId);
      }
      case 'assignment': {
        const a = await this.prisma.assignment.findUnique({
          where: { id: target.id },
          select: {
            companyId: true,
            handyman: { select: { userId: true } },
            request: { select: { createdByUserId: true, customerAccount: { select: { ownerUserId: true } } } },
          },
        });
        if (!a) return false;
        if (a.handyman.userId === userId) return true;
        if (a.request.customerAccount.ownerUserId === userId || a.request.createdByUserId === userId) return true;
        return !!a.companyId && (await this.isActiveManager(userId, a.companyId));
      }
      default:
        return false;
    }
  }

  roomName(target: RoomJoin): string {
    return target.room === 'company' ? rooms.company(target.id) : target.room === 'request' ? rooms.request(target.id) : rooms.assignment(target.id);
  }

  /** Inverse of roomName for joinable rooms (null for user:/admins/socket-id rooms). */
  static parseRoom(room: string): RoomJoin | null {
    const i = room.indexOf(':');
    if (i <= 0) return null;
    const kind = room.slice(0, i);
    const id = room.slice(i + 1);
    if (kind === 'company' || kind === 'request' || kind === 'assignment') return { room: kind, id } as RoomJoin;
    return null;
  }

  /**
   * Re-checks the rooms of every live socket of `userId` against the current DB state: company/assignment/request rooms the
   * user may no longer join are left (manager removed or demoted), company rooms of new ACTIVE MANAGER memberships are joined.
   * Lanes that change memberships (B2: remove/demote/promote a member) call this after their transaction commits; the
   * `realtime.sweep` reconciler task also runs it for every connected user. Never throws.
   */
  async refreshUser(userId: string): Promise<{ left: number; joined: number }> {
    const out = { left: 0, joined: 0 };
    const server = this.realtime.attached;
    if (!server) return out;
    try {
      const nsp = server.of('/');
      const ids = nsp.adapter.rooms.get(rooms.user(userId));
      if (!ids || !ids.size) return out;
      const sockets = [...ids].map((id) => nsp.sockets.get(id)).filter((s): s is NonNullable<typeof s> => !!s) as unknown as LiveSocket[];
      const userSockets = sockets.filter((s) => s.data?.principal?.kind === 'user' && s.data.principal.userId === userId);
      if (!userSockets.length) return out;
      const wanted = await this.initialRooms(userSockets[0]!.data!.principal!);
      const verdicts = new Map<string, boolean>();
      for (const s of userSockets) {
        const principal = s.data!.principal!;
        for (const room of [...s.rooms]) {
          if (wanted.includes(room)) continue;
          const target = RoomAccessService.parseRoom(room);
          if (!target) continue;
          let ok = verdicts.get(room);
          if (ok === undefined) {
            ok = await this.canJoin(principal, target);
            verdicts.set(room, ok);
          }
          if (!ok) {
            await s.leave(room);
            out.left++;
          }
        }
        const missing = wanted.filter((r) => !s.rooms.has(r));
        if (missing.length) {
          await s.join(missing);
          out.joined += missing.length;
        }
        s.data!.initialRooms = wanted;
      }
    } catch (err) {
      this.log.warn(`refreshUser(${userId}) failed: ${(err as Error).message}`);
    }
    return out;
  }
}
