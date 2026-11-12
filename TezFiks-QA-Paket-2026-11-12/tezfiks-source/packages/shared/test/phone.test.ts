import { describe, expect, it } from 'vitest';
import { formatPhone, maskPhone, normalizeAzMobile } from '../src/phone';

describe('phone', () => {
  it('normalizes Azerbaijani mobile input variants to E.164', () => {
    for (const input of ['050 123 45 67', '0501234567', '994501234567', '+994 50 123 45 67', '+994501234567', '50 123 45 67', '(050) 123-45-67']) {
      expect(normalizeAzMobile(input), input).toBe('+994501234567');
    }
    expect(normalizeAzMobile('055 555 55 55')).toBe('+994555555555');
    expect(normalizeAzMobile('070 123 45 67')).toBe('+994701234567');
    expect(normalizeAzMobile('099 123 45 67')).toBe('+994991234567');
  });
  it('rejects landlines, garbage and foreign numbers', () => {
    expect(normalizeAzMobile('012 498 00 00')).toBeNull();
    expect(normalizeAzMobile('abc')).toBeNull();
    expect(normalizeAzMobile('')).toBeNull();
    expect(normalizeAzMobile('+7 916 123 45 67')).toBeNull();
    expect(normalizeAzMobile('050 123 45')).toBeNull();
  });
  it('formats and masks', () => {
    expect(formatPhone('+994501234567', 'international')).toBe('+994 50 123 45 67');
    expect(formatPhone('+994501234567', 'national')).toBe('050 123 45 67');
    expect(maskPhone('+994501234567')).toBe('+99450*****67');
  });
});
