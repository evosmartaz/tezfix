import type { Category, CreateRequestBody, CustomerType, ProviderPreference, RequestTiming } from '@tezfiks/shared';
import { addressInputFromDraft, validateAddressDraft, type AddressDraft } from './address';
import { emergencyFeeFor, emergencyShortfall, validateScheduledAt, type TimingConfig } from './timing';

export const DESCRIPTION_MIN = 3;
export const DESCRIPTION_MAX = 2000;
export const SAVE_LABEL_MAX = 60;

/** Everything on the "Sifariş yarat" screen (board 02 B3). */
export interface RequestFormValues {
  categoryId: string | null;
  description: string;
  photoFileIds: string[];
  timing: RequestTiming;
  scheduledAt: Date | null;
  slots: number;
  providerPreference: ProviderPreference;
  address: AddressDraft;
  saveAddress: boolean;
  saveAddressLabel: string;
}

export interface RequestFormContext {
  category: Category | null;
  customerType: CustomerType | null;
  config: TimingConfig;
  now: Date;
  /** Customer wallet available balance (qəpik), null while unknown. */
  walletAvailable: number | null;
}

export type RequestFormField = 'category' | 'description' | 'photos' | 'address' | 'scheduledAt' | 'slots' | 'timing' | 'saveAddressLabel';

/** i18n keys (customer namespace) per invalid field. */
export type RequestFormErrors = Partial<Record<RequestFormField, string>>;

/** Only company customers may choose a provider type (spec: INDIVIDUAL customers are forced to ANY). */
export function canChooseProvider(customerType: CustomerType | null): boolean {
  return customerType === 'COMPANY';
}

export function effectivePreference(pref: ProviderPreference, customerType: CustomerType | null): ProviderPreference {
  return canChooseProvider(customerType) ? pref : 'ANY';
}

export function validateRequestForm(v: RequestFormValues, ctx: RequestFormContext): RequestFormErrors {
  const e: RequestFormErrors = {};
  const cat = ctx.category;
  if (!v.categoryId || !cat) e.category = 'request.errors.categoryRequired';
  else if (cat.kind !== 'SERVICE' || !cat.active) e.category = 'request.errors.categoryRequired';
  else if (cat.flow === 'QUOTE') e.category = 'request.errors.categoryRequiresQuote';

  const desc = v.description.trim();
  if (desc.length < DESCRIPTION_MIN) e.description = 'request.errors.descriptionTooShort';
  else if (desc.length > DESCRIPTION_MAX) e.description = 'request.errors.descriptionTooLong';

  if (v.photoFileIds.length > ctx.config.maxPhotos) e.photos = 'request.errors.tooManyPhotos';

  const addr = validateAddressDraft(v.address);
  if (addr) e.address = addr;

  if (v.timing === 'SCHEDULED') {
    const s = validateScheduledAt(v.scheduledAt, ctx.now, ctx.config);
    if (s === 'SCHEDULE_REQUIRED') e.scheduledAt = 'request.errors.scheduleRequired';
    else if (s === 'SCHEDULE_TOO_SOON') e.scheduledAt = 'request.errors.scheduleTooSoon';
    else if (s === 'SCHEDULE_TOO_FAR') e.scheduledAt = 'request.errors.scheduleTooFar';
  }

  if (!Number.isInteger(v.slots) || v.slots < 1 || v.slots > ctx.config.maxSlots) e.slots = 'request.errors.slotsRange';

  if (v.timing === 'EMERGENCY') {
    if (cat && !cat.emergencyAllowed) e.timing = 'request.errors.emergencyNotAllowed';
    else if (ctx.walletAvailable !== null && emergencyShortfall(ctx.walletAvailable, emergencyFeeFor('EMERGENCY', v.slots, ctx.config)) > 0) {
      e.timing = 'request.errors.emergencyBalance';
    }
  }

  if (v.saveAddress) {
    const label = v.saveAddressLabel.trim();
    // Saving to the address book needs a name; without one the API would silently not save it.
    if (!label) e.saveAddressLabel = 'request.errors.labelRequired';
    else if (label.length > SAVE_LABEL_MAX) e.saveAddressLabel = 'request.errors.labelTooLong';
  }
  return e;
}

/** Body for POST /requests (contract CreateRequestBodySchema). Call only after validateRequestForm returned no errors. */
export function buildCreateRequestBody(v: RequestFormValues, ctx: Pick<RequestFormContext, 'customerType'>): CreateRequestBody {
  if (!v.categoryId) throw new Error('categoryId missing');
  const body: CreateRequestBody = {
    categoryId: v.categoryId,
    description: v.description.trim(),
    photoFileIds: [...v.photoFileIds],
    timing: v.timing,
    slots: v.slots,
    providerPreference: effectivePreference(v.providerPreference, ctx.customerType),
    address: addressInputFromDraft(v.address),
  };
  if (v.timing === 'SCHEDULED' && v.scheduledAt) body.scheduledAt = v.scheduledAt.toISOString();
  const label = v.saveAddressLabel.trim();
  if (v.saveAddress && label) body.saveAddressLabel = label;
  return body;
}

/** The order of fields on screen, to scroll to / announce the first error. */
export const FIELD_ORDER: RequestFormField[] = ['category', 'address', 'description', 'photos', 'timing', 'scheduledAt', 'slots', 'saveAddressLabel'];

export function firstError(e: RequestFormErrors): { field: RequestFormField; key: string } | null {
  for (const f of FIELD_ORDER) {
    const key = e[f];
    if (key) return { field: f, key };
  }
  return null;
}
