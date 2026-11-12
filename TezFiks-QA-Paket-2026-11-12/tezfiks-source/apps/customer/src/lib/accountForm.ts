import { UpsertCustomerAccountBodySchema, type CustomerType, type LegalForm } from '@tezfiks/shared';

/** Board 02 A3 "Hesab tipini seçin": individual, or company with name, VÖEN, legal form and contact person. */
export interface AccountFormValues {
  type: CustomerType;
  companyName: string;
  voen: string;
  legalForm: LegalForm | null;
  contactPerson: string;
}

export type AccountFormField = 'companyName' | 'voen' | 'contactPerson';

/** i18n keys (customer namespace) per invalid field. */
export type AccountFormErrors = Partial<Record<AccountFormField, string>>;

export interface UpsertAccountBody {
  type: CustomerType;
  companyName?: string;
  voen?: string;
  legalForm?: LegalForm;
  contactPerson?: string;
}

export function emptyAccountForm(contactPerson = ''): AccountFormValues {
  return { type: 'INDIVIDUAL', companyName: '', voen: '', legalForm: 'MMC', contactPerson };
}

/** VÖEN is exactly 10 digits; spaces and dashes typed by the user are ignored. */
export function normalizeVoen(text: string): string {
  return (text ?? '').replace(/[\s-]/g, '');
}

/** Keeps only digits while typing, at most 10. */
export function sanitizeVoenInput(text: string): string {
  return (text ?? '').replace(/\D/g, '').slice(0, 10);
}

export function validateAccountForm(v: AccountFormValues): AccountFormErrors {
  const errors: AccountFormErrors = {};
  if (v.type === 'INDIVIDUAL') return errors;
  const name = v.companyName.trim();
  if (name.length < 2) errors.companyName = 'account.errors.companyNameRequired';
  else if (name.length > 120) errors.companyName = 'account.errors.companyNameTooLong';
  const voen = normalizeVoen(v.voen);
  if (!voen) errors.voen = 'account.errors.voenRequired';
  else if (!/^\d{10}$/.test(voen)) errors.voen = 'account.errors.voenInvalid';
  const contact = v.contactPerson.trim();
  if (contact && contact.length < 2) errors.contactPerson = 'account.errors.contactPersonTooShort';
  else if (contact.length > 120) errors.contactPerson = 'account.errors.contactPersonTooLong';
  return errors;
}

export function hasErrors(errors: object): boolean {
  return Object.values(errors).some(Boolean);
}

/**
 * Body for POST /customer/account. Individual accounts send only the type (switching to individual keeps the wallet
 * and the company fields stored server-side are irrelevant); company accounts send trimmed fields and drop empty optional ones.
 */
export function buildAccountBody(v: AccountFormValues): UpsertAccountBody {
  if (v.type === 'INDIVIDUAL') return { type: 'INDIVIDUAL' };
  const body: UpsertAccountBody = {
    type: 'COMPANY',
    companyName: v.companyName.trim(),
    voen: normalizeVoen(v.voen),
  };
  if (v.legalForm) body.legalForm = v.legalForm;
  const contact = v.contactPerson.trim();
  if (contact) body.contactPerson = contact;
  return body;
}

/** True when the body passes the contract schema (defence in depth before the network call). */
export function isValidAccountBody(body: UpsertAccountBody): boolean {
  return UpsertCustomerAccountBodySchema.safeParse(body).success;
}

/** The edit form prefilled from the stored account (profile → company info). */
export function accountFormFromAccount(
  acc: { type: CustomerType; companyName: string | null; voen: string | null; legalForm: LegalForm | null; contactPerson: string | null } | null | undefined,
  fallbackContact = '',
): AccountFormValues {
  if (!acc) return emptyAccountForm(fallbackContact);
  return {
    type: acc.type,
    companyName: acc.companyName ?? '',
    voen: acc.voen ?? '',
    legalForm: acc.legalForm ?? 'MMC',
    contactPerson: acc.contactPerson ?? fallbackContact,
  };
}
