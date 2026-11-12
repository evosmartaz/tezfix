import { z } from 'zod';
import { endpoint } from '../define';
import { Id, IsoDateTime } from '../common';
import { LocaleSchema, VerificationStatus } from '../../enums';

export const KycStatusSchema = z.object({
  status: z.union([VerificationStatus.schema, z.literal('NONE')]),
  submittedAt: IsoDateTime.nullable(),
  reviewedAt: IsoDateTime.nullable(),
  rejectReason: z.string().nullable(),
  attemptsLeft24h: z.int(),
});
export type KycStatus = z.infer<typeof KycStatusSchema>;

/** Result of on-device face checks for one guided-selfie frame (ML Kit). Advisory only; an admin decides. */
export const SelfieCheckSchema = z.object({
  faces: z.int().min(0),
  rotationY: z.number().nullable(),
  eyesOpenMin: z.number().nullable(),
  ok: z.boolean(),
});

export const KycSubmitBodySchema = z
  .object({
    subject: z.enum(['HANDYMAN', 'COMPANY']).default('HANDYMAN'),
    /** Required when subject = COMPANY (the caller must manage it). */
    companyId: Id.optional(),
    idFrontFileId: Id,
    idBackFileId: Id,
    selfie: z.object({ frontFileId: Id, turnFileId: Id, blinkFileId: Id }),
    selfieChecks: z
      .object({ front: SelfieCheckSchema, turn: SelfieCheckSchema, blink: SelfieCheckSchema })
      .nullable()
      .default(null),
    tradeProofFileIds: z.array(Id).max(5).default([]),
    companyDocFileIds: z.array(Id).max(5).default([]),
    consent: z.object({
      policyVersion: z.string().min(1).max(40),
      locale: LocaleSchema,
      accepted: z.literal(true),
    }),
  })
  .refine((v) => v.subject === 'HANDYMAN' || !!v.companyId, { message: 'companyId required', path: ['companyId'] });

export const kycEndpoints = {
  submit: endpoint({
    method: 'POST',
    path: '/kyc/submissions',
    auth: 'user',
    body: KycSubmitBodySchema,
    response: KycStatusSchema,
    summary: 'ID front/back + guided selfie; the profile becomes PENDING_REVIEW until a TezFiks admin decides',
  }),
  status: endpoint({
    method: 'GET',
    path: '/kyc/status',
    auth: 'user',
    query: z.object({ companyId: Id.optional() }),
    response: KycStatusSchema,
  }),
};
