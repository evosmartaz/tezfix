import type { PayoutMethodType } from '@tezfiks/shared';

/** Same rules as the server (apps/api payout-method.ts): Luhn card 16-19 digits; AZ IBAN = AZ + 2 digits + 4 letters + 20 alphanumerics. */
export const AZ_IBAN_RE = /^AZ\d{2}[A-Z]{4}[A-Z0-9]{20}$/;

export function luhnValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** Card input: digits only, at most 19. */
export function sanitizeCardNumber(text: string): string {
  return (text ?? '').replace(/\D/g, '').slice(0, 19);
}

/** "4242424242424242" → "4242 4242 4242 4242". */
export function formatCardNumber(digits: string): string {
  return sanitizeCardNumber(digits).replace(/(\d{4})(?=\d)/g, '$1 ');
}

/** IBAN input: uppercase letters and digits, at most 28. */
export function sanitizeIban(text: string): string {
  return (text ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 28);
}

/** "AZ21NABZ00000000137010001944" → "AZ21 NABZ 0000 0000 1370 1000 1944". */
export function formatIban(iban: string): string {
  return sanitizeIban(iban).replace(/(.{4})(?=.)/g, '$1 ');
}

export interface PayoutForm {
  type: PayoutMethodType;
  number: string;
  holderName: string;
}

export type PayoutField = 'number' | 'holderName';

/** Validates the payout card / IBAN form; returns the PUT /pro/payout-method body (unformatted number). */
export function validatePayoutForm(form: PayoutForm): {
  errors: Partial<Record<PayoutField, 'invalidCard' | 'invalidIban' | 'holderRequired'>>;
  body: PayoutForm | null;
} {
  const errors: Partial<Record<PayoutField, 'invalidCard' | 'invalidIban' | 'holderRequired'>> = {};
  let number: string;
  if (form.type === 'CARD') {
    number = sanitizeCardNumber(form.number);
    if (number.length < 16 || !luhnValid(number)) errors.number = 'invalidCard';
  } else {
    number = sanitizeIban(form.number);
    if (!AZ_IBAN_RE.test(number)) errors.number = 'invalidIban';
  }
  const holderName = (form.holderName ?? '').trim().replace(/\s+/g, ' ');
  if (holderName.length < 3 || holderName.length > 100) errors.holderName = 'holderRequired';
  return Object.keys(errors).length ? { errors, body: null } : { errors, body: { type: form.type, number, holderName } };
}
