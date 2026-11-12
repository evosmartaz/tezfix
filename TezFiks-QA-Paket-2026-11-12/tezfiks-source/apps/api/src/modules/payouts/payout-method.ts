import type { PayoutMethodType } from '@tezfiks/shared';

const MASK = '••••';

/** Luhn checksum over a digit string. */
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

export const AZ_IBAN_RE = /^AZ\d{2}[A-Z]{4}[A-Z0-9]{20}$/;

/**
 * Validates a payout card or IBAN and returns only its masked form (the full number is never stored):
 * card (Luhn-valid, 16-19 digits) -> "•••• 4242"; IBAN (AZ + 2 digits + 4 letters + 20 alphanumerics) -> "AZ21 •••• 1234".
 * Returns null when invalid.
 */
export function maskPayoutNumber(type: PayoutMethodType, raw: string): string | null {
  const compact = raw.replace(/[\s-]/g, '');
  if (type === 'CARD') {
    if (!/^\d{16,19}$/.test(compact) || !luhnValid(compact)) return null;
    return `${MASK} ${compact.slice(-4)}`;
  }
  const iban = compact.toUpperCase();
  if (!AZ_IBAN_RE.test(iban)) return null;
  return `${iban.slice(0, 4)} ${MASK} ${iban.slice(-4)}`;
}
