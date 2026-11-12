import { z } from 'zod';
import { FileKind, Vertical, CustomerType } from '../enums';

export const Id = z.uuid();
export const IsoDateTime = z.iso.datetime({ offset: true });
export const IsoDate = z.iso.date();
/** Integer minor units (qəpik). */
export const Money = z.int();
export const PositiveMoney = z.int().min(1);
export const Lat = z.number().min(-90).max(90);
export const Lng = z.number().min(-180).max(180);
export const LatLngSchema = z.object({ lat: Lat, lng: Lng });
export type LatLngDto = z.infer<typeof LatLngSchema>;

export const Ok = z.object({ ok: z.literal(true) });
export const IdParams = z.object({ id: Id });

export const PageQuery = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export function paginated<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() });
}

export const FileRefSchema = z.object({
  id: Id,
  kind: FileKind.schema,
  /** Signed URL usable without auth headers (expires; refetch the parent resource to renew). */
  url: z.string(),
  contentType: z.string(),
  width: z.int().nullable(),
  height: z.int().nullable(),
});
export type FileRef = z.infer<typeof FileRefSchema>;

const optText = (max: number) => z.string().trim().max(max).nullish();

/** Address as entered by the customer. The map pin (lat/lng) is the dispatch truth. */
export const AddressInputSchema = z.object({
  lat: Lat,
  lng: Lng,
  formatted: z.string().trim().min(1).max(300),
  placeId: optText(300),
  district: optText(80),
  street: optText(120),
  building: optText(40),
  block: optText(40),
  entrance: optText(20),
  floor: optText(20),
  apartment: optText(20),
  intercom: optText(40),
  note: optText(300),
});
export type AddressInput = z.input<typeof AddressInputSchema>;

export const AddressViewSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  formatted: z.string(),
  placeId: z.string().nullable(),
  district: z.string().nullable(),
  street: z.string().nullable(),
  building: z.string().nullable(),
  block: z.string().nullable(),
  entrance: z.string().nullable(),
  floor: z.string().nullable(),
  apartment: z.string().nullable(),
  intercom: z.string().nullable(),
  note: z.string().nullable(),
});
export type AddressView = z.infer<typeof AddressViewSchema>;

export const CategoryRefSchema = z.object({
  id: Id,
  slug: z.string(),
  name: z.string(),
  icon: z.string().nullable(),
  vertical: Vertical.schema,
});
export type CategoryRef = z.infer<typeof CategoryRefSchema>;

export const PriceSchema = z.object({ labor: Money, materials: Money, total: Money });
export type Price = z.infer<typeof PriceSchema>;

export const PriceInputSchema = z.object({
  labor: z.int().min(0).max(100_000_00),
  materials: z.int().min(0).max(100_000_00),
});

export const RouteSchema = z.object({
  polyline: z.string(),
  durationSec: z.int(),
  distanceM: z.int(),
  computedAt: IsoDateTime,
  source: z.enum(['google', 'fallback']),
});
export type RouteDto = z.infer<typeof RouteSchema>;

export const LiveLocationSchema = z.object({ lat: z.number(), lng: z.number(), heading: z.number().nullable(), at: IsoDateTime });

/** The customer as shown to providers (never includes the phone). */
export const CustomerPublicSchema = z.object({
  firstName: z.string(),
  lastInitial: z.string(),
  photo: FileRefSchema.nullable(),
  ratingAvg: z.number().nullable(),
  ratingCount: z.int().nullable(),
  type: CustomerType.schema,
  companyName: z.string().nullable(),
});
export type CustomerPublic = z.infer<typeof CustomerPublicSchema>;

export const DateRangeQuery = z.object({ from: IsoDateTime.optional(), to: IsoDateTime.optional() });
