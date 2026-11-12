import { Injectable } from '@nestjs/common';
import {
  ACTIVE_ASSIGNMENT_STATUSES,
  type CompanyRole,
  type CustomerType,
  type DevicePlatform,
  type HandymanKind,
  type Locale,
  type Me,
  type PushProvider,
  type UserStatus,
  type VerificationStatus,
} from '@tezfiks/shared';
import { PrismaService, inTx } from '../../infra/prisma.service';
import { Clock } from '../../infra/clock';
import { SessionsService } from '../../common/auth/sessions.service';
import { ApiException } from '../../common/http/api-exception';
import { iso } from '../../common/mapping';
import { FilesService } from '../files/files.service';

export interface UpdateMeInput {
  firstName?: string;
  lastName?: string;
  locale?: Locale;
  photoFileId?: string | null;
}

export interface RegisterDeviceInput {
  deviceId: string;
  app: 'CUSTOMER' | 'PRO' | 'PANEL';
  platform: DevicePlatform;
  pushToken: string | null;
  pushProvider: PushProvider | null;
  appVersion?: string;
}

/** Request statuses that block account deletion (the customer still has an open request). */
export const OPEN_REQUEST_STATUSES = ['SEARCHING', 'ASSIGNED', 'IN_PROGRESS'] as const;

/**
 * File kinds kept when an account is deleted: they are part of other parties' records (B2B reports delivered to customers,
 * dispute cases, company documents) and are removed by those records' own retention rules. Everything else the user
 * uploaded (profile photo, request photos, personal KYC images) is purged immediately.
 */
export const FILE_KINDS_KEPT_ON_ACCOUNT_DELETION = ['REPORT_PHOTO', 'CASE_PHOTO', 'COMPANY_DOC'] as const;

/** The signed-in user's profile (/me), devices and account deletion. */
@Injectable()
export class MeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly sessions: SessionsService,
    private readonly clock: Clock,
  ) {}

  async getMe(userId: string): Promise<Me> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        photo: true,
        customerAccount: { select: { id: true, type: true, companyName: true } },
        handymanProfile: { select: { id: true, kind: true, status: true, companyId: true, isOnline: true } },
        memberships: {
          where: { status: 'ACTIVE' },
          orderBy: { joinedAt: 'asc' },
          include: { company: { select: { id: true, name: true, status: true } } },
        },
      },
    });
    if (!user) throw new ApiException('UNAUTHORIZED');
    const photo = user.photo && !user.photo.deletedAt ? this.files.refOf(user.photo) : null;
    return {
      id: user.id,
      phone: user.phone,
      firstName: user.firstName ?? null,
      lastName: user.lastName ?? null,
      photo,
      locale: user.locale as Locale,
      status: user.status as UserStatus,
      createdAt: iso(user.createdAt),
      profileComplete: !!(user.firstName?.trim() && user.lastName?.trim()),
      customer: user.customerAccount
        ? {
            id: user.customerAccount.id,
            type: user.customerAccount.type as CustomerType,
            companyName: user.customerAccount.companyName ?? null,
          }
        : null,
      handyman: user.handymanProfile
        ? {
            id: user.handymanProfile.id,
            kind: user.handymanProfile.kind as HandymanKind,
            status: user.handymanProfile.status as VerificationStatus,
            companyId: user.handymanProfile.companyId ?? null,
            isOnline: user.handymanProfile.isOnline,
          }
        : null,
      companies: user.memberships.map((m) => ({
        companyId: m.company.id,
        companyName: m.company.name,
        role: m.role as CompanyRole,
        companyStatus: m.company.status as VerificationStatus,
      })),
    };
  }

  async update(userId: string, input: UpdateMeInput): Promise<Me> {
    const current = await this.prisma.user.findUnique({ where: { id: userId }, select: { photoFileId: true } });
    if (!current) throw new ApiException('UNAUTHORIZED');
    const data: { firstName?: string; lastName?: string; locale?: Locale; photoFileId?: string | null } = {};
    if (input.firstName !== undefined) data.firstName = input.firstName.normalize('NFC');
    if (input.lastName !== undefined) data.lastName = input.lastName.normalize('NFC');
    if (input.locale !== undefined) data.locale = input.locale;
    if (input.photoFileId !== undefined) {
      if (input.photoFileId !== null) await this.files.assertOwned(userId, [input.photoFileId], ['PROFILE_PHOTO']);
      data.photoFileId = input.photoFileId;
    }
    await inTx(this.prisma, async (tx) => {
      await tx.user.update({ where: { id: userId }, data });
      if (input.photoFileId) {
        // Choosing a photo again (e.g. one replaced earlier) cancels its pending purge.
        await tx.file.updateMany({ where: { id: input.photoFileId, deletedAt: null }, data: { purgeAfter: null } });
      }
    });
    // The replaced/removed profile photo is no longer referenced: let the purge delete it.
    if (input.photoFileId !== undefined && current.photoFileId && current.photoFileId !== input.photoFileId) {
      await this.files.markPurge([current.photoFileId], this.clock.now());
    }
    return this.getMe(userId);
  }

  /** Upserts the push registration of (user, device, app). A push token moves with the device: other rows lose it. */
  async registerDevice(userId: string, input: RegisterDeviceInput): Promise<void> {
    await inTx(this.prisma, async (tx) => {
      if (input.pushToken) {
        await tx.device.updateMany({
          where: { pushToken: input.pushToken, NOT: { userId, deviceId: input.deviceId, app: input.app } },
          data: { pushToken: null },
        });
      }
      await tx.device.upsert({
        where: { userId_deviceId_app: { userId, deviceId: input.deviceId, app: input.app } },
        create: {
          userId,
          deviceId: input.deviceId,
          app: input.app,
          platform: input.platform,
          pushToken: input.pushToken,
          pushProvider: input.pushProvider,
          appVersion: input.appVersion ?? null,
        },
        update: {
          platform: input.platform,
          pushToken: input.pushToken,
          pushProvider: input.pushProvider,
          ...(input.appVersion !== undefined ? { appVersion: input.appVersion } : {}),
        },
      });
    });
  }

  /**
   * Deletes the account (Google Play requirement): refused while a job or request is open; otherwise anonymizes the
   * user (phone -> "deleted:<id>", names and photo removed), revokes sessions, deletes devices, takes the handyman
   * offline and schedules the user's personal files for purge (see FILE_KINDS_KEPT_ON_ACCOUNT_DELETION). The phone number
   * can register again as a new user. The last active manager of a company with active jobs is refused as well.
   */
  async deleteAccount(userId: string): Promise<void> {
    const now = this.clock.now();
    await inTx(this.prisma, async (tx) => {
      // Lock the user row, then check and anonymize in the same transaction (no check-then-act gap).
      await tx.$queryRawUnsafe('SELECT id FROM users WHERE id = $1::uuid FOR UPDATE', userId);
      const activeAssignment = await tx.assignment.findFirst({
        where: {
          status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] },
          OR: [{ request: { customerAccount: { ownerUserId: userId } } }, { handyman: { userId } }],
        },
        select: { id: true },
      });
      if (activeAssignment) throw new ApiException('INVALID_STATE', { reason: 'ACTIVE_ASSIGNMENT', assignmentId: activeAssignment.id });
      const openRequest = await tx.serviceRequest.findFirst({
        where: { status: { in: [...OPEN_REQUEST_STATUSES] }, customerAccount: { ownerUserId: userId } },
        select: { id: true },
      });
      if (openRequest) throw new ApiException('INVALID_STATE', { reason: 'OPEN_REQUEST', requestId: openRequest.id });
      // The last active manager of a company with running jobs cannot leave the company without a manager.
      const managed = await tx.companyMember.findMany({
        where: { userId, role: 'MANAGER', status: 'ACTIVE' },
        select: { companyId: true },
      });
      for (const { companyId } of managed) {
        const otherManagers = await tx.companyMember.count({
          where: { companyId, role: 'MANAGER', status: 'ACTIVE', userId: { not: userId }, user: { status: 'ACTIVE' } },
        });
        if (otherManagers) continue;
        const companyJob = await tx.assignment.findFirst({
          where: { companyId, status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] } },
          select: { id: true },
        });
        if (companyJob) {
          throw new ApiException('INVALID_STATE', { reason: 'COMPANY_ACTIVE_ASSIGNMENT', companyId, assignmentId: companyJob.id });
        }
      }

      await tx.user.update({
        where: { id: userId },
        data: { phone: `deleted:${userId}`, firstName: null, lastName: null, photoFileId: null, status: 'DELETED', deletedAt: now },
      });
      await tx.device.deleteMany({ where: { userId } });
      await tx.handymanProfile.updateMany({ where: { userId }, data: { isOnline: false, onlineSince: null } });
      await tx.file.updateMany({
        where: { ownerUserId: userId, deletedAt: null, kind: { notIn: [...FILE_KINDS_KEPT_ON_ACCOUNT_DELETION] } },
        data: { purgeAfter: now },
      });
    });
    await this.sessions.revokeAllForUser(userId, 'ACCOUNT_DELETED');
  }
}
