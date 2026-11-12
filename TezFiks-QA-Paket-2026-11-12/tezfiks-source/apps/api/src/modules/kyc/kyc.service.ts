import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { EndpointBody, FileKind, KycStatus, VerificationStatus, api } from '@tezfiks/shared';
import { PrismaService, inTx, type Tx } from '../../infra/prisma.service';
import { Clock } from '../../infra/clock';
import { RealtimeService } from '../../infra/realtime.service';
import { newId } from '../../infra/ids';
import { ApiException } from '../../common/http/api-exception';
import { I18nService } from '../../common/i18n/i18n.service';
import { FilesService } from '../files/files.service';
import { WalletAccessService } from '../wallet/wallet-access.service';
import { ProviderViewsService, type KycSubjectRef } from '../pro/provider-views.service';
import { KYC_MAX_SUBMISSIONS } from '../pro/provider-common';

type SubmitBody = EndpointBody<typeof api.kyc.submit>;

export const CONSENT_TEXT_KEY = 'server.providers.consentText';

/** Throws when a profile/company in `status` may not submit KYC now. */
function assertCanSubmit(status: VerificationStatus): void {
  if (status === 'PENDING_REVIEW') throw new ApiException('KYC_ALREADY_PENDING');
  if (status !== 'DRAFT' && status !== 'REJECTED') throw new ApiException('INVALID_STATE', { status });
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** KYC submissions (solo handyman or company manager) and status. Review decisions live in ProviderReviewService. */
@Injectable()
export class KycService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly realtime: RealtimeService,
    private readonly i18n: I18nService,
    private readonly files: FilesService,
    private readonly access: WalletAccessService,
    private readonly views: ProviderViewsService,
  ) {}

  /**
   * HANDYMAN: the caller's SOLO profile in DRAFT/REJECTED. COMPANY: a company the caller manages, in DRAFT/REJECTED.
   * PENDING_REVIEW -> KYC_ALREADY_PENDING; APPROVED/BLOCKED (or a company worker profile) -> INVALID_STATE; files must be
   * the caller's with the right kinds (FILE_NOT_OWNED); at most 3 submissions per subject per 24 h (KYC_RESUBMIT_LIMIT).
   */
  async submit(userId: string, body: SubmitBody, ip: string | null): Promise<KycStatus> {
    let subject: KycSubjectRef;
    if (body.subject === 'COMPANY') {
      const company = await this.access.managedCompany(userId, body.companyId!);
      assertCanSubmit(company.status);
      subject = { companyId: company.id };
    } else {
      const profile = await this.prisma.handymanProfile.findUnique({ where: { userId } });
      if (!profile) throw new ApiException('NOT_FOUND', { entity: 'HandymanProfile' });
      if (profile.kind !== 'SOLO') throw new ApiException('INVALID_STATE', { reason: 'COMPANY_WORKER' });
      assertCanSubmit(profile.status);
      subject = { handymanId: profile.id };
    }

    const groups: Array<[string[], FileKind[]]> = [
      [[body.idFrontFileId], ['KYC_ID_FRONT']],
      [[body.idBackFileId], ['KYC_ID_BACK']],
      [[body.selfie.frontFileId], ['KYC_SELFIE']],
      [[body.selfie.turnFileId], ['KYC_SELFIE_TURN']],
      [[body.selfie.blinkFileId], ['KYC_SELFIE_BLINK']],
      [body.tradeProofFileIds, ['KYC_TRADE_PROOF']],
      [body.companyDocFileIds, ['COMPANY_DOC']],
    ];
    for (const [ids, kinds] of groups) await this.files.assertOwned(userId, ids, kinds);

    const consentText = this.i18n.t(body.consent.locale, CONSENT_TEXT_KEY);
    const now = this.clock.now();
    await inTx(this.prisma, async (tx) => {
      const status = await this.lockSubject(tx, subject);
      assertCanSubmit(status);
      const recent = await this.views.recentSubmissions(subject, tx);
      if (recent >= KYC_MAX_SUBMISSIONS) throw new ApiException('KYC_RESUBMIT_LIMIT', { max: KYC_MAX_SUBMISSIONS, windowHours: 24 });
      await tx.verificationSubmission.create({
        data: {
          id: newId(),
          subject: 'handymanId' in subject ? 'HANDYMAN' : 'COMPANY',
          handymanId: 'handymanId' in subject ? subject.handymanId : null,
          companyId: 'companyId' in subject ? subject.companyId : null,
          submittedByUserId: userId,
          idFrontFileId: body.idFrontFileId,
          idBackFileId: body.idBackFileId,
          selfieFrontFileId: body.selfie.frontFileId,
          selfieTurnFileId: body.selfie.turnFileId,
          selfieBlinkFileId: body.selfie.blinkFileId,
          tradeProofFileIds: body.tradeProofFileIds,
          companyDocFileIds: body.companyDocFileIds,
          selfieChecks: body.selfieChecks ?? undefined,
          consentPolicyVersion: body.consent.policyVersion,
          consentLocale: body.consent.locale,
          consentTextHash: sha256Hex(consentText),
          consentAcceptedAt: now,
          consentIp: ip,
          status: 'PENDING_REVIEW',
          createdAt: now,
        },
      });
      const data = { status: 'PENDING_REVIEW' as const, rejectReason: null };
      if ('handymanId' in subject) await tx.handymanProfile.update({ where: { id: subject.handymanId }, data });
      else await tx.company.update({ where: { id: subject.companyId }, data });
    });

    const entityId = 'handymanId' in subject ? subject.handymanId : subject.companyId;
    this.realtime.toAdmins('admin:event', { type: 'handymanId' in subject ? 'KYC_SUBMITTED' : 'COMPANY_KYC_SUBMITTED', entityId });
    this.realtime.toUser(userId, 'profile:updated', { reason: 'KYC_SUBMITTED' });
    return this.views.kycStatus(subject, { status: 'PENDING_REVIEW', rejectReason: null });
  }

  /** Locks the profile/company row and returns its current status. */
  private async lockSubject(tx: Tx, subject: KycSubjectRef): Promise<VerificationStatus> {
    const rows =
      'handymanId' in subject
        ? await tx.$queryRawUnsafe<Array<{ status: VerificationStatus }>>(
            'SELECT status::text AS status FROM handyman_profiles WHERE id = $1::uuid FOR UPDATE',
            subject.handymanId,
          )
        : await tx.$queryRawUnsafe<Array<{ status: VerificationStatus }>>(
            'SELECT status::text AS status FROM companies WHERE id = $1::uuid FOR UPDATE',
            subject.companyId,
          );
    if (!rows.length) throw new ApiException('NOT_FOUND');
    return rows[0]!.status;
  }

  /** KYC status of the caller's handyman profile (NONE without one) or of a company the caller manages. */
  async status(userId: string, companyId?: string): Promise<KycStatus> {
    if (companyId) {
      const c = await this.access.managedCompany(userId, companyId);
      return this.views.kycStatus({ companyId: c.id }, { status: c.status, rejectReason: c.rejectReason ?? null });
    }
    const p = await this.prisma.handymanProfile.findUnique({ where: { userId } });
    if (!p) return this.views.noneKycStatus();
    return this.views.kycStatus({ handymanId: p.id }, { status: p.status, rejectReason: p.rejectReason ?? null });
  }
}
