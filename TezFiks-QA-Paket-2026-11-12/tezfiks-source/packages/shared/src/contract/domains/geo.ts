import { z } from 'zod';
import { endpoint } from '../define';

export const GeoAddressSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  formatted: z.string(),
  placeId: z.string().nullable(),
  district: z.string().nullable(),
  street: z.string().nullable(),
  building: z.string().nullable(),
  source: z.enum(['google', 'fallback']),
});
export type GeoAddress = z.infer<typeof GeoAddressSchema>;

export const geoEndpoints = {
  reverse: endpoint({
    method: 'GET',
    path: '/geo/reverse',
    auth: 'user',
    query: z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) }),
    response: GeoAddressSchema,
    summary: 'Reverse geocodes a map pin in the caller language (Google Geocoding; coordinates as text when unavailable)',
  }),
  autocomplete: endpoint({
    method: 'GET',
    path: '/geo/autocomplete',
    auth: 'user',
    query: z.object({
      q: z.string().trim().min(2).max(120),
      sessionToken: z.string().min(8).max(64),
      lat: z.coerce.number().min(-90).max(90).optional(),
      lng: z.coerce.number().min(-180).max(180).optional(),
    }),
    response: z.object({
      items: z.array(z.object({ placeId: z.string(), primary: z.string(), secondary: z.string().nullable() })),
      source: z.enum(['google', 'fallback']),
    }),
  }),
  place: endpoint({
    method: 'GET',
    path: '/geo/place/:placeId',
    auth: 'user',
    params: z.object({ placeId: z.string().min(1).max(300) }),
    query: z.object({ sessionToken: z.string().min(8).max(64).optional() }),
    response: GeoAddressSchema,
  }),
};
