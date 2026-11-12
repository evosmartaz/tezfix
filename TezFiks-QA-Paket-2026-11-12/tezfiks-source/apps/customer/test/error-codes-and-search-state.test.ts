import { ApiError, ERROR_CODES } from '@tezfiks/shared';
import { emptyAddressDraft } from '../src/lib/address';
import { isPartlyFilledSearch, requestHref, showsSearchLink, staysOnSearchScreen } from '../src/lib/orders';
import { isRequestInProgress, isRetryableWithSameKey, requestErrorInfo } from '../src/lib/requestErrors';
import { buildCreateRequestBody, validateRequestForm, type RequestFormValues } from '../src/lib/requestPayload';
import { FALLBACK_TIMING_CONFIG } from '../src/lib/timing';
import { IDS, categories, detail, summary } from './fixtures';

const LANGS = ['az', 'ru', 'en'] as const;
const commonErrors = (l: string) => (require(`../../../packages/i18n/locales/${l}/common.json`) as { errors: Record<string, string> }).errors;
const customer = (l: string) => require(`../../../packages/i18n/locales/${l}/customer.json`) as Record<string, Record<string, unknown>>;

function lookup(obj: Record<string, unknown>, dotted: string): unknown {
  return dotted.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}

describe('API error codes → localized messages', () => {
  it.each([...ERROR_CODES, 'NETWORK', 'TIMEOUT'])('%s gets its own message in az/ru/en', (code) => {
    const info = requestErrorInfo(new ApiError(400, code, 'x'));
    expect(info.code).toBe(code);
    expect(info.messageKey).toBe(`common:errors.${code}`);
    for (const l of LANGS) expect(commonErrors(l)[code]).toBeTruthy();
  });

  it('codes the reviewer found falling back to INTERNAL now keep their meaning', () => {
    for (const code of ['USER_BLOCKED', 'PROFILE_INCOMPLETE', 'NOT_ELIGIBLE', 'IDEMPOTENCY_CONFLICT', 'GUARANTEE_NOT_AVAILABLE']) {
      expect(requestErrorInfo(new ApiError(403, code, 'x')).messageKey).toBe(`common:errors.${code}`);
    }
  });

  it('CONFLICT REQUEST_IN_PROGRESS (idempotency lock) keeps the key and has its own message', () => {
    const err = new ApiError(409, 'CONFLICT', 'x', { reason: 'REQUEST_IN_PROGRESS' });
    expect(isRequestInProgress(err)).toBe(true);
    expect(isRetryableWithSameKey(err)).toBe(true);
    expect(requestErrorInfo(err)).toEqual({ code: 'CONFLICT', messageKey: 'request.inProgress', action: null, field: null });
    for (const l of LANGS) expect(typeof lookup(customer(l), 'request.inProgress')).toBe('string');
    // Any other CONFLICT is a business answer: new key next time, generic conflict message.
    const other = new ApiError(409, 'CONFLICT', 'x', { reason: 'SOMETHING_ELSE' });
    expect(isRequestInProgress(other)).toBe(false);
    expect(isRetryableWithSameKey(other)).toBe(false);
    expect(requestErrorInfo(other).messageKey).toBe('common:errors.CONFLICT');
    expect(isRetryableWithSameKey(new ApiError(409, 'CONFLICT', 'x'))).toBe(false);
  });
});

describe('search state (spec 6.1: ASSIGNED keeps isSearching while open slots are dispatched)', () => {
  it('the searching screen stays open for a partly filled request and closes once the search is over', () => {
    expect(staysOnSearchScreen(summary())).toBe(true);
    expect(staysOnSearchScreen(summary({ status: 'EXPIRED', isSearching: false }))).toBe(true);
    expect(staysOnSearchScreen(summary({ status: 'ASSIGNED', isSearching: true, slotsRequested: 2, slotsFilled: 1 }))).toBe(true);
    expect(staysOnSearchScreen(summary({ status: 'ASSIGNED', isSearching: false }))).toBe(false);
    expect(staysOnSearchScreen(summary({ status: 'IN_PROGRESS', isSearching: true }))).toBe(false);
    expect(staysOnSearchScreen(summary({ status: 'CANCELLED', isSearching: false }))).toBe(false);
    expect(isPartlyFilledSearch(summary({ status: 'ASSIGNED', isSearching: true }))).toBe(true);
    expect(isPartlyFilledSearch(summary({ status: 'SEARCHING' }))).toBe(false);
  });

  it('the detail links to the live search exactly when the searching screen would show it', () => {
    expect(showsSearchLink(detail())).toBe(true);
    expect(showsSearchLink(detail({ status: 'ASSIGNED', isSearching: true }))).toBe(true);
    expect(showsSearchLink(detail({ status: 'ASSIGNED', isSearching: false }))).toBe(false);
    // Scheduled: only once the live ring dispatch runs (search state present).
    expect(showsSearchLink(detail({ timing: 'SCHEDULED' }))).toBe(false);
    expect(showsSearchLink(detail({ timing: 'SCHEDULED', status: 'ASSIGNED', isSearching: true, search: null }))).toBe(false);
    expect(showsSearchLink(detail({ timing: 'SCHEDULED', status: 'ASSIGNED', isSearching: true }))).toBe(true);
    for (const r of [detail(), detail({ status: 'ASSIGNED', isSearching: true })]) {
      if (showsSearchLink(r)) expect(staysOnSearchScreen(r)).toBe(true);
    }
    // The orders list still opens an assigned request on its detail.
    expect(requestHref(summary({ status: 'ASSIGNED', isSearching: true }))).toBe(`/request/${IDS.request}`);
  });
});

describe('save to address book', () => {
  const values = (over: Partial<RequestFormValues>): RequestFormValues => ({
    categoryId: IDS.plumbing,
    description: 'Kran damcılayır',
    photoFileIds: [],
    timing: 'NOW',
    scheduledAt: null,
    slots: 1,
    providerPreference: 'ANY',
    address: { ...emptyAddressDraft(), lat: 40.4, lng: 49.8, formatted: 'Atatürk pr. 45' },
    saveAddress: false,
    saveAddressLabel: '',
    ...over,
  });
  const ctx = {
    category: categories().find((c) => c.id === IDS.plumbing)!,
    customerType: 'INDIVIDUAL' as const,
    config: FALLBACK_TIMING_CONFIG,
    now: new Date('2026-10-25T10:00:00.000Z'),
    walletAvailable: 5000,
  };

  it('requires a name when the switch is on, so the address is never silently not saved', () => {
    expect(validateRequestForm(values({ saveAddress: true, saveAddressLabel: '' }), ctx).saveAddressLabel).toBe('request.errors.labelRequired');
    expect(validateRequestForm(values({ saveAddress: true, saveAddressLabel: '   ' }), ctx).saveAddressLabel).toBe('request.errors.labelRequired');
    expect(validateRequestForm(values({ saveAddress: true, saveAddressLabel: 'Ev' }), ctx)).toEqual({});
    expect(validateRequestForm(values({ saveAddress: false, saveAddressLabel: '' }), ctx)).toEqual({});
    expect(buildCreateRequestBody(values({ saveAddress: true, saveAddressLabel: ' Ev ' }), ctx).saveAddressLabel).toBe('Ev');
    for (const l of LANGS) {
      expect(typeof lookup(customer(l), 'request.errors.labelRequired')).toBe('string');
      expect(typeof lookup(customer(l), 'address.labelRequired')).toBe('string');
    }
  });
});
