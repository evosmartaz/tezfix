import { z } from 'zod';
import { CategoryRefSchema, FileRefSchema, Id, IsoDateTime, Money } from '../common';
import { CustomerType, OfferStatus, OfferTarget, RequestTiming } from '../../enums';

export const OfferCandidateWorkerSchema = z.object({
  handymanId: Id,
  userId: Id,
  firstName: z.string(),
  lastName: z.string(),
  photo: FileRefSchema.nullable(),
  ratingAvg: z.number().nullable(),
  completedCount: z.int(),
  distanceM: z.int().nullable(),
  /** "Sifarişdədir" when true, "Boşdur" when false. */
  busy: z.boolean(),
  online: z.boolean(),
  hasTrade: z.boolean(),
});
export type OfferCandidateWorker = z.infer<typeof OfferCandidateWorkerSchema>;

/** An offer as shown to a solo handyman or a company manager (board 03 B2, board 04). No phone, no exact address. */
export const OfferViewSchema = z.object({
  id: Id,
  requestId: Id,
  requestNumber: z.int(),
  target: OfferTarget.schema,
  companyId: Id.nullable(),
  status: OfferStatus.schema,
  sentAt: IsoDateTime,
  expiresAt: IsoDateTime,
  timing: RequestTiming.schema,
  scheduledAt: IsoDateTime.nullable(),
  isEmergency: z.boolean(),
  isGuaranteeFix: z.boolean(),
  category: CategoryRefSchema,
  /** First 140 characters of the description. */
  descriptionShort: z.string(),
  address: z.object({
    district: z.string().nullable(),
    street: z.string().nullable(),
    /** Area-level text without flat details, e.g. "Atatürk pr. 45, Nərimanov". */
    area: z.string(),
    /** Rounded to ~100 m. */
    lat: z.number(),
    lng: z.number(),
  }),
  distanceM: z.int().nullable(),
  etaMin: z.int().nullable(),
  customer: z.object({
    firstName: z.string(),
    lastInitial: z.string(),
    ratingAvg: z.number().nullable(),
    ratingCount: z.int(),
    type: CustomerType.schema,
    companyName: z.string().nullable(),
  }),
  /** Fee that will be held on acceptance (per worker for company offers). */
  fee: Money,
  slotsOpen: z.int(),
  slotsRequested: z.int(),
  /** Company offers only: workers the manager can send ("Ustanı seçin"). */
  candidateWorkers: z.array(OfferCandidateWorkerSchema),
});
export type OfferView = z.infer<typeof OfferViewSchema>;

export const OffersResponseSchema = z.object({ items: z.array(OfferViewSchema), serverNow: IsoDateTime });
