import { CreateRequestBodySchema } from '@tezfiks/shared';
import { emptyAddressDraft, type AddressDraft } from '../src/lib/address';
import {
  buildCreateRequestBody,
  canChooseProvider,
  effectivePreference,
  firstError,
  validateRequestForm,
  type RequestFormContext,
  type RequestFormValues,
} from '../src/lib/requestPayload';
import { FALLBACK_TIMING_CONFIG } from '../src/lib/timing';
import { IDS, categories } from './fixtures';

const items = categories();
const plumbing = items.find((c) => c.id === IDS.plumbing)!;
const painting = items.find((c) => c.id === IDS.painting)!;
const brigade = items.find((c) => c.id === IDS.brigade)!;
const NOW = new Date('2026-10-25T10:00:00.000Z');

const pinned: AddressDraft = {
  ...emptyAddressDraft(),
  lat: 40.4093,
  lng: 49.8671,
  formatted: 'Atatürk pr. 45, Nərimanov',
  district: 'Nərimanov',
  street: 'Atatürk pr.',
  building: '45',
  entrance: ' 2 ',
  floor: '5',
  apartment: '12',
};

function values(over: Partial<RequestFormValues> = {}): RequestFormValues {
  return {
    categoryId: IDS.plumbing,
    description: '  Mətbəxdə kran damcılayır  ',
    photoFileIds: [IDS.file],
    timing: 'NOW',
    scheduledAt: null,
    slots: 1,
    providerPreference: 'ANY',
    address: pinned,
    saveAddress: false,
    saveAddressLabel: '',
    ...over,
  };
}

function ctx(over: Partial<RequestFormContext> = {}): RequestFormContext {
  return { category: plumbing, customerType: 'INDIVIDUAL', config: FALLBACK_TIMING_CONFIG, now: NOW, walletAvailable: 5000, ...over };
}

describe('request form validation', () => {
  it('a complete form has no errors', () => {
    expect(validateRequestForm(values(), ctx())).toEqual({});
  });

  it('requires a service, rejects quote-only and inactive services', () => {
    expect(validateRequestForm(values({ categoryId: null }), ctx({ category: null })).category).toBe('request.errors.categoryRequired');
    expect(validateRequestForm(values({ categoryId: IDS.brigade }), ctx({ category: brigade })).category).toBe('request.errors.categoryRequiresQuote');
    expect(validateRequestForm(values(), ctx({ category: { ...plumbing, active: false } })).category).toBe('request.errors.categoryRequired');
    expect(validateRequestForm(values(), ctx({ category: { ...plumbing, kind: 'GROUP' } })).category).toBe('request.errors.categoryRequired');
  });

  it('description must be 3..2000 characters after trimming', () => {
    expect(validateRequestForm(values({ description: '  ab ' }), ctx()).description).toBe('request.errors.descriptionTooShort');
    expect(validateRequestForm(values({ description: 'abc' }), ctx()).description).toBeUndefined();
    expect(validateRequestForm(values({ description: 'a'.repeat(2001) }), ctx()).description).toBe('request.errors.descriptionTooLong');
  });

  it('photos are limited by maxPhotos from the public config', () => {
    const six = Array.from({ length: 6 }, (_, i) => `00000000-0000-4000-a000-00000000010${i}`);
    expect(validateRequestForm(values({ photoFileIds: six }), ctx()).photos).toBe('request.errors.tooManyPhotos');
    expect(validateRequestForm(values({ photoFileIds: six.slice(0, 5) }), ctx()).photos).toBeUndefined();
  });

  it('requires a map pin for the address', () => {
    expect(validateRequestForm(values({ address: emptyAddressDraft() }), ctx()).address).toBe('request.errors.addressRequired');
  });

  it('scheduled requests need a time inside the lead window', () => {
    expect(validateRequestForm(values({ timing: 'SCHEDULED', scheduledAt: null }), ctx()).scheduledAt).toBe('request.errors.scheduleRequired');
    expect(validateRequestForm(values({ timing: 'SCHEDULED', scheduledAt: new Date('2026-10-25T10:29:00.000Z') }), ctx()).scheduledAt).toBe(
      'request.errors.scheduleTooSoon',
    );
    expect(validateRequestForm(values({ timing: 'SCHEDULED', scheduledAt: new Date('2026-11-25T10:00:00.000Z') }), ctx()).scheduledAt).toBe(
      'request.errors.scheduleTooFar',
    );
    expect(validateRequestForm(values({ timing: 'SCHEDULED', scheduledAt: new Date('2026-10-25T12:00:00.000Z') }), ctx())).toEqual({});
    // A stale scheduledAt is ignored for NOW requests.
    expect(validateRequestForm(values({ timing: 'NOW', scheduledAt: new Date('2020-01-01T00:00:00.000Z') }), ctx())).toEqual({});
  });

  it('slots must be 1..maxSlots', () => {
    expect(validateRequestForm(values({ slots: 0 }), ctx()).slots).toBe('request.errors.slotsRange');
    expect(validateRequestForm(values({ slots: 11 }), ctx()).slots).toBe('request.errors.slotsRange');
    expect(validateRequestForm(values({ slots: 10 }), ctx()).slots).toBeUndefined();
  });

  it('emergency needs an allowed category and enough wallet balance for 5 AZN per handyman', () => {
    expect(validateRequestForm(values({ timing: 'EMERGENCY', categoryId: IDS.painting }), ctx({ category: painting })).timing).toBe(
      'request.errors.emergencyNotAllowed',
    );
    expect(validateRequestForm(values({ timing: 'EMERGENCY', slots: 3 }), ctx({ walletAvailable: 1499 })).timing).toBe('request.errors.emergencyBalance');
    expect(validateRequestForm(values({ timing: 'EMERGENCY', slots: 3 }), ctx({ walletAvailable: 1500 })).timing).toBeUndefined();
    // Unknown balance: the API decides (INSUFFICIENT_BALANCE).
    expect(validateRequestForm(values({ timing: 'EMERGENCY', slots: 3 }), ctx({ walletAvailable: null })).timing).toBeUndefined();
  });

  it('address book label is limited to 60 characters', () => {
    expect(validateRequestForm(values({ saveAddress: true, saveAddressLabel: 'x'.repeat(61) }), ctx()).saveAddressLabel).toBe('request.errors.labelTooLong');
  });

  it('firstError follows the on-screen order', () => {
    expect(firstError({ description: 'a', category: 'b' })).toEqual({ field: 'category', key: 'b' });
    expect(firstError({ slots: 's', address: 'a' })).toEqual({ field: 'address', key: 'a' });
    expect(firstError({})).toBeNull();
  });
});

describe('request payload builder', () => {
  it('builds a contract-valid NOW body with trimmed text and an omitted empty address part', () => {
    const body = buildCreateRequestBody(values(), ctx());
    expect(body).toEqual({
      categoryId: IDS.plumbing,
      description: 'Mətbəxdə kran damcılayır',
      photoFileIds: [IDS.file],
      timing: 'NOW',
      slots: 1,
      providerPreference: 'ANY',
      address: {
        lat: 40.4093,
        lng: 49.8671,
        formatted: 'Atatürk pr. 45, Nərimanov',
        district: 'Nərimanov',
        street: 'Atatürk pr.',
        building: '45',
        entrance: '2',
        floor: '5',
        apartment: '12',
      },
    });
    expect(CreateRequestBodySchema.safeParse(body).success).toBe(true);
  });

  it('includes scheduledAt only for scheduled requests', () => {
    const at = new Date('2026-10-25T12:00:00.000Z');
    expect(buildCreateRequestBody(values({ timing: 'SCHEDULED', scheduledAt: at }), ctx()).scheduledAt).toBe('2026-10-25T12:00:00.000Z');
    expect(buildCreateRequestBody(values({ timing: 'NOW', scheduledAt: at }), ctx())).not.toHaveProperty('scheduledAt');
    expect(CreateRequestBodySchema.safeParse(buildCreateRequestBody(values({ timing: 'SCHEDULED', scheduledAt: at }), ctx())).success).toBe(true);
  });

  it('forces ANY provider preference for individual customers; companies may choose', () => {
    expect(canChooseProvider('INDIVIDUAL')).toBe(false);
    expect(canChooseProvider(null)).toBe(false);
    expect(canChooseProvider('COMPANY')).toBe(true);
    expect(effectivePreference('COMPANY', 'INDIVIDUAL')).toBe('ANY');
    expect(buildCreateRequestBody(values({ providerPreference: 'COMPANY' }), { customerType: 'INDIVIDUAL' }).providerPreference).toBe('ANY');
    expect(buildCreateRequestBody(values({ providerPreference: 'COMPANY', slots: 4 }), { customerType: 'COMPANY' })).toMatchObject({
      providerPreference: 'COMPANY',
      slots: 4,
    });
  });

  it('adds the address-book label only when saving with a non-empty label', () => {
    expect(buildCreateRequestBody(values({ saveAddress: true, saveAddressLabel: '  Ev  ' }), ctx()).saveAddressLabel).toBe('Ev');
    expect(buildCreateRequestBody(values({ saveAddress: true, saveAddressLabel: '   ' }), ctx())).not.toHaveProperty('saveAddressLabel');
    expect(buildCreateRequestBody(values({ saveAddress: false, saveAddressLabel: 'Ev' }), ctx())).not.toHaveProperty('saveAddressLabel');
  });

  it('builds the formatted text from the fields, or the coordinates, when the geocoder gave none', () => {
    const noText = { ...pinned, formatted: '' };
    expect(buildCreateRequestBody(values({ address: noText }), ctx()).address.formatted).toBe('Atatürk pr., 45, Nərimanov');
    const bare = { ...emptyAddressDraft(), lat: 40.1, lng: 49.2 };
    expect(buildCreateRequestBody(values({ address: bare }), ctx()).address).toEqual({ lat: 40.1, lng: 49.2, formatted: '40.10000, 49.20000' });
  });

  it('throws without a category (callers validate first)', () => {
    expect(() => buildCreateRequestBody(values({ categoryId: null }), ctx())).toThrow();
  });
});
