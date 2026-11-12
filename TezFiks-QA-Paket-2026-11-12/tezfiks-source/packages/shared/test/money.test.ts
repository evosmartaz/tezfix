import { describe, expect, it } from 'vitest';
import { formatMoney, toMinor } from '../src/money';

const NB = ' ';

describe('money', () => {
  it('formats in three locales with the manat sign', () => {
    expect(formatMoney(1250, 'az')).toBe(`12,50${NB}₼`);
    expect(formatMoney(123450, 'az')).toBe(`1.234,50${NB}₼`);
    expect(formatMoney(123450, 'ru')).toBe(`1${NB}234,50${NB}₼`);
    expect(formatMoney(123450, 'en')).toBe('₼1,234.50');
  });
  it('supports compact, sign and negative amounts', () => {
    expect(formatMoney(1000, 'az', { compact: true })).toBe(`10${NB}₼`);
    expect(formatMoney(-1000, 'az')).toBe(`-10,00${NB}₼`);
    expect(formatMoney(5000, 'en', { sign: true })).toBe('+₼50.00');
    expect(formatMoney(5, 'az', { plain: true })).toBe('0,05');
  });
  it('parses major amounts to minor units', () => {
    expect(toMinor('12.5')).toBe(1250);
    expect(toMinor('12,50')).toBe(1250);
    expect(toMinor(10)).toBe(1000);
    expect(toMinor('0.05')).toBe(5);
    expect(toMinor('-3')).toBe(-300);
    expect(() => toMinor('12.345')).toThrow();
    expect(() => toMinor('abc')).toThrow();
  });
});
