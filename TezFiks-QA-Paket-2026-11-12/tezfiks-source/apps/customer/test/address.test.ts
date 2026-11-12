import { AddressInputSchema } from '@tezfiks/shared';
import {
  addressDetails,
  addressInputFromDraft,
  applyGeoAddress,
  applyPin,
  composeFormatted,
  emptyAddressDraft,
  hasPin,
  savedAddressToDraft,
  validateAddressDraft,
} from '../src/lib/address';
import { ADDRESS } from './fixtures';

describe('address draft helpers', () => {
  it('a reverse-geocoded pin fills district/street/building and keeps what only the customer knows', () => {
    const d = { ...emptyAddressDraft(), apartment: '12', floor: '5', district: 'old', note: 'Qırmızı qapı' };
    const out = applyGeoAddress(d, {
      lat: 40.41,
      lng: 49.87,
      formatted: 'Atatürk pr. 45, Nərimanov',
      placeId: 'p1',
      district: 'Nərimanov',
      street: 'Atatürk pr.',
      building: null,
      source: 'google',
    });
    expect(out).toMatchObject({ lat: 40.41, lng: 49.87, formatted: 'Atatürk pr. 45, Nərimanov', placeId: 'p1', district: 'Nərimanov', street: 'Atatürk pr.', building: '' });
    expect(out).toMatchObject({ apartment: '12', floor: '5', note: 'Qırmızı qapı' });
  });

  it('a bare pin uses the coordinates as text (like the API fallback)', () => {
    const out = applyPin(emptyAddressDraft(), 40.409312, 49.867098);
    expect(out.formatted).toBe('40.40931, 49.86710');
    expect(hasPin(out)).toBe(true);
    expect(hasPin(emptyAddressDraft())).toBe(false);
  });

  it('saved addresses and request addresses convert to drafts with empty strings for nulls', () => {
    const d = savedAddressToDraft(ADDRESS);
    expect(d).toMatchObject({ lat: 40.4093, block: '', entrance: '2', apartment: '12', intercom: '' });
    expect(addressInputFromDraft(d)).toEqual({
      lat: 40.4093,
      lng: 49.8671,
      formatted: 'Atatürk pr. 45, Nərimanov',
      district: 'Nərimanov',
      street: 'Atatürk pr.',
      building: '45',
      entrance: '2',
      floor: '5',
      apartment: '12',
    });
  });

  it('validates the pin and field lengths against AddressInputSchema', () => {
    expect(validateAddressDraft(emptyAddressDraft())).toBe('request.errors.addressRequired');
    const ok = savedAddressToDraft(ADDRESS);
    expect(validateAddressDraft(ok)).toBeNull();
    expect(validateAddressDraft({ ...ok, apartment: 'x'.repeat(21) })).toBe('request.errors.addressTooLong');
    expect(validateAddressDraft({ ...ok, formatted: 'x'.repeat(301) })).toBe('request.errors.addressTooLong');
    expect(AddressInputSchema.safeParse(addressInputFromDraft(ok)).success).toBe(true);
    expect(() => addressInputFromDraft(emptyAddressDraft())).toThrow();
  });

  it('keeps Azerbaijani characters intact end to end', () => {
    const d = { ...emptyAddressDraft(), lat: 40.4, lng: 49.8, formatted: '', street: 'Şəhriyar küç.', building: '7ə', district: 'Xətai' };
    expect(composeFormatted(d)).toBe('Şəhriyar küç., 7ə, Xətai');
    expect(addressInputFromDraft(d).formatted).toBe('Şəhriyar küç., 7ə, Xətai');
  });

  it('detail line lists block, entrance, floor and apartment via the translator', () => {
    const t = (k: string, v?: Record<string, unknown>) => `${k.split('.')[1]}=${String(v?.value)}`;
    expect(addressDetails({ block: null, entrance: '2', floor: '5', apartment: '12' }, t)).toBe('entranceShort=2, floorShort=5, apartmentShort=12');
    expect(addressDetails({ block: null, entrance: null, floor: null, apartment: null }, t)).toBe('');
  });
});
