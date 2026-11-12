import { draftFromPrice, keypadDisplay, priceTotals, validatePrice, PRICE_PART_MAX } from '../src/lib/price';
import { formatCardNumber, formatIban, luhnValid, sanitizeCardNumber, sanitizeIban, validatePayoutForm } from '../src/lib/payout';
import { checkoutOutcome, parseTopupAmount, PAYMENT_POLL_MAX_MS, PAYMENT_RETURN_URL, shouldPollPayment } from '../src/lib/topup';
import { applyKeypadKey } from '@tezfiks/mobile';

describe('keypad math (board 03 B4: İş haqqı + Material xərci = Yekun məbləğ)', () => {
  it('sums labour and materials in qəpik', () => {
    expect(priceTotals({ labor: '35', materials: '10' })).toEqual({ labor: 3500, materials: 1000, total: 4500 });
    expect(priceTotals({ labor: '12.5', materials: '0.05' })).toEqual({ labor: 1250, materials: 5, total: 1255 });
    expect(priceTotals({ labor: '', materials: '' })).toEqual({ labor: 0, materials: 0, total: 0 });
    expect(priceTotals({ labor: '7.', materials: '' })).toEqual({ labor: 700, materials: 0, total: 700 });
  });

  it('typing on the keypad builds the amounts', () => {
    let v = '';
    for (const k of ['3', '5', '.', '5', '0', '9'] as const) v = applyKeypadKey(v, k);
    expect(v).toBe('35.50');
    expect(priceTotals({ labor: v, materials: '10' }).total).toBe(4550);
  });

  it('rejects a zero total except for a guarantee re-fix, and amounts over the contract limit', () => {
    expect(validatePrice({ labor: '', materials: '' })).toEqual({ error: 'zero', body: null });
    expect(validatePrice({ labor: '0', materials: '0' }, { allowZero: true })).toEqual({ error: null, body: { labor: 0, materials: 0 } });
    expect(validatePrice({ labor: '35', materials: '10' })).toEqual({ error: null, body: { labor: 3500, materials: 1000 } });
    expect(validatePrice({ labor: '100001', materials: '' }).error).toBe('tooLarge');
    expect(validatePrice({ labor: String(PRICE_PART_MAX / 100), materials: '' }).error).toBeNull();
  });

  it('prefills and displays', () => {
    expect(draftFromPrice({ labor: 3500, materials: 450 })).toEqual({ labor: '35', materials: '4.5' });
    expect(draftFromPrice(null)).toEqual({ labor: '', materials: '' });
    expect(keypadDisplay('')).toBe('0.00');
    expect(keypadDisplay('35')).toBe('35.00');
    expect(keypadDisplay('4.5')).toBe('4.50');
  });
});

describe('payout card form', () => {
  it('Luhn and formatting', () => {
    expect(luhnValid('4242424242424242')).toBe(true);
    expect(luhnValid('4242424242424241')).toBe(false);
    expect(sanitizeCardNumber('4242 4242-4242 4242 999 9')).toBe('4242424242424242999');
    expect(formatCardNumber('4242424242424242')).toBe('4242 4242 4242 4242');
    expect(sanitizeIban('az21 nabz 0000 0000 1370 1000 1944')).toBe('AZ21NABZ00000000137010001944');
    expect(formatIban('AZ21NABZ00000000137010001944')).toBe('AZ21 NABZ 0000 0000 1370 1000 1944');
  });

  it('validates card and IBAN like the server', () => {
    expect(validatePayoutForm({ type: 'CARD', number: '4242 4242 4242 4242', holderName: '  Elvin   Məmmədov ' })).toEqual({
      errors: {},
      body: { type: 'CARD', number: '4242424242424242', holderName: 'Elvin Məmmədov' },
    });
    expect(validatePayoutForm({ type: 'CARD', number: '4242 4242 4242 4241', holderName: 'Elvin' }).errors).toEqual({ number: 'invalidCard' });
    expect(validatePayoutForm({ type: 'CARD', number: '4242 4242 4242', holderName: 'Elvin' }).errors).toEqual({ number: 'invalidCard' });
    expect(validatePayoutForm({ type: 'IBAN', number: 'AZ21 NABZ 0000 0000 1370 1000 1944', holderName: 'FixPro MMC' }).body).toEqual({
      type: 'IBAN',
      number: 'AZ21NABZ00000000137010001944',
      holderName: 'FixPro MMC',
    });
    expect(validatePayoutForm({ type: 'IBAN', number: 'AZ21 0000', holderName: 'Ab' }).errors).toEqual({ number: 'invalidIban', holderName: 'holderRequired' });
  });
});

describe('top-up amounts and checkout polling', () => {
  it('parses AZN into qəpik within 1..1000 AZN', () => {
    expect(parseTopupAmount('25')).toEqual({ amount: 2500, error: null });
    expect(parseTopupAmount('12,50')).toEqual({ amount: 1250, error: null });
    expect(parseTopupAmount('1')).toEqual({ amount: 100, error: null });
    expect(parseTopupAmount('0.99')).toEqual({ amount: null, error: 'tooSmall' });
    expect(parseTopupAmount('1000')).toEqual({ amount: 100000, error: null });
    expect(parseTopupAmount('1000.01')).toEqual({ amount: null, error: 'tooLarge' });
    expect(parseTopupAmount('abc')).toEqual({ amount: null, error: 'invalid' });
    expect(parseTopupAmount('')).toEqual({ amount: null, error: 'invalid' });
  });

  it('returns to the pro app scheme', () => {
    expect(PAYMENT_RETURN_URL).toBe('tezfiksusta://payment');
  });

  it('maps intent statuses and stops polling when done or too old', () => {
    expect(checkoutOutcome('CREATED')).toBe('pending');
    expect(checkoutOutcome('SUCCEEDED')).toBe('succeeded');
    expect(checkoutOutcome('FAILED')).toBe('failed');
    expect(checkoutOutcome('CANCELLED')).toBe('failed');
    expect(shouldPollPayment(null, 'CREATED', 0)).toBe(false);
    expect(shouldPollPayment(1000, 'CREATED', 2000)).toBe(true);
    expect(shouldPollPayment(1000, undefined, 2000)).toBe(true);
    expect(shouldPollPayment(1000, 'SUCCEEDED', 2000)).toBe(false);
    expect(shouldPollPayment(0, 'CREATED', PAYMENT_POLL_MAX_MS)).toBe(false);
  });
});
