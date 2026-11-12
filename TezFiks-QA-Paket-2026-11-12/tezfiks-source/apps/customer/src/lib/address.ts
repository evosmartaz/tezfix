import type { AddressInput, AddressView, GeoAddress, SavedAddress } from '@tezfiks/shared';

/** Structured address fields of the create-request form (board 02 B3). Text fields use '' for empty. */
export interface AddressDraft {
  lat: number | null;
  lng: number | null;
  formatted: string;
  placeId: string | null;
  district: string;
  street: string;
  building: string;
  block: string;
  entrance: string;
  floor: string;
  apartment: string;
  intercom: string;
  note: string;
}

export const ADDRESS_TEXT_FIELDS = ['district', 'street', 'building', 'block', 'entrance', 'floor', 'apartment', 'intercom', 'note'] as const;
export type AddressTextField = (typeof ADDRESS_TEXT_FIELDS)[number];

/** Max lengths from AddressInputSchema. */
export const ADDRESS_MAX: Record<AddressTextField | 'formatted', number> = {
  formatted: 300,
  district: 80,
  street: 120,
  building: 40,
  block: 40,
  entrance: 20,
  floor: 20,
  apartment: 20,
  intercom: 40,
  note: 300,
};

export function emptyAddressDraft(): AddressDraft {
  return {
    lat: null,
    lng: null,
    formatted: '',
    placeId: null,
    district: '',
    street: '',
    building: '',
    block: '',
    entrance: '',
    floor: '',
    apartment: '',
    intercom: '',
    note: '',
  };
}

/**
 * The pin moved and was reverse geocoded: take the coordinates, the formatted text and the geocoded district/street/building.
 * Fields only the customer knows (block, entrance, floor, apartment, intercom, note) are kept.
 */
export function applyGeoAddress(draft: AddressDraft, geo: GeoAddress): AddressDraft {
  return {
    ...draft,
    lat: geo.lat,
    lng: geo.lng,
    formatted: geo.formatted,
    placeId: geo.placeId,
    district: geo.district ?? '',
    street: geo.street ?? '',
    building: geo.building ?? '',
  };
}

/** Pin position without a geocoded text yet (or when geocoding failed): coordinates as the text, like the API fallback. */
export function applyPin(draft: AddressDraft, lat: number, lng: number): AddressDraft {
  return { ...draft, lat, lng, placeId: null, formatted: coordinatesText(lat, lng) };
}

export function coordinatesText(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

export function savedAddressToDraft(a: SavedAddress | AddressView): AddressDraft {
  return {
    lat: a.lat,
    lng: a.lng,
    formatted: a.formatted,
    placeId: a.placeId,
    district: a.district ?? '',
    street: a.street ?? '',
    building: a.building ?? '',
    block: a.block ?? '',
    entrance: a.entrance ?? '',
    floor: a.floor ?? '',
    apartment: a.apartment ?? '',
    intercom: a.intercom ?? '',
    note: a.note ?? '',
  };
}

/** "Nərimanov r., Atatürk pr., 45" from the structured fields (used when there is no geocoded text). */
export function composeFormatted(d: Pick<AddressDraft, 'district' | 'street' | 'building'>): string {
  return [d.street.trim(), d.building.trim(), d.district.trim()].filter(Boolean).join(', ');
}

export function hasPin(d: AddressDraft): d is AddressDraft & { lat: number; lng: number } {
  return typeof d.lat === 'number' && typeof d.lng === 'number' && Number.isFinite(d.lat) && Number.isFinite(d.lng);
}

/** i18n key of the first address problem, or null. */
export function validateAddressDraft(d: AddressDraft): string | null {
  if (!hasPin(d)) return 'request.errors.addressRequired';
  const formatted = d.formatted.trim() || composeFormatted(d);
  if (!formatted) return 'request.errors.addressRequired';
  if (formatted.length > ADDRESS_MAX.formatted) return 'request.errors.addressTooLong';
  for (const f of ADDRESS_TEXT_FIELDS) if (d[f].trim().length > ADDRESS_MAX[f]) return 'request.errors.addressTooLong';
  return null;
}

/** AddressInput for the API: trimmed, empty optional fields omitted. Throws when there is no pin. */
export function addressInputFromDraft(d: AddressDraft): AddressInput {
  if (!hasPin(d)) throw new Error('address pin missing');
  const formatted = (d.formatted.trim() || composeFormatted(d) || coordinatesText(d.lat, d.lng)).slice(0, ADDRESS_MAX.formatted);
  const out: AddressInput = { lat: d.lat, lng: d.lng, formatted };
  if (d.placeId) out.placeId = d.placeId;
  for (const f of ADDRESS_TEXT_FIELDS) {
    const v = d[f].trim();
    if (v) out[f] = v;
  }
  return out;
}

/** Detail line "Blok 2, giriş 3, mərtəbə 5, mənzil 12" built by the caller's translator. */
export function addressDetails(
  a: Pick<AddressView, 'block' | 'entrance' | 'floor' | 'apartment'>,
  t: (key: string, vars?: Record<string, unknown>) => string,
): string {
  const parts: string[] = [];
  if (a.block) parts.push(t('address.blockShort', { value: a.block }));
  if (a.entrance) parts.push(t('address.entranceShort', { value: a.entrance }));
  if (a.floor) parts.push(t('address.floorShort', { value: a.floor }));
  if (a.apartment) parts.push(t('address.apartmentShort', { value: a.apartment }));
  return parts.join(', ');
}
