import { formatMoney } from '@tezfiks/shared';
import {
  applyKeypadKey,
  azDigitsToE164,
  countdownProgress,
  countdownSeconds,
  formatAzNational,
  formatCountdown,
  initialsOf,
  keypadToMinor,
  minorToKeypad,
  sanitizeAzPhoneDigits,
  upperAzSafe,
  type KeypadKey,
} from '../src/format';
import { computeClockOffset, clockStore, serverNow } from '../src/clock';

describe('phone helpers', () => {
  it.each([
    ['050 123 45 67', '501234567'],
    ['0501234567', '501234567'],
    ['+994 50 123 45 67', '501234567'],
    ['+994501234567', '501234567'],
    ['994501234567', '501234567'],
    ['00994501234567', '501234567'],
    ['50-123-45-67', '501234567'],
    ['(050) 123-45-67', '501234567'],
    ['5012345678999', '501234567'],
    ['', ''],
  ])('sanitizes %j to %j', (input, expected) => {
    expect(sanitizeAzPhoneDigits(input)).toBe(expected);
  });

  it('keeps a typed national number that starts with 99 (099 operator) while typing', () => {
    expect(sanitizeAzPhoneDigits('994')).toBe('994');
    expect(sanitizeAzPhoneDigits('991234567')).toBe('991234567');
  });

  it.each([
    ['', ''],
    ['5', '5'],
    ['50', '50'],
    ['501', '50 1'],
    ['50123', '50 123'],
    ['5012345', '50 123 45'],
    ['501234567', '50 123 45 67'],
    ['551234567', '55 123 45 67'],
    ['701234567', '70 123 45 67'],
    ['991234567', '99 123 45 67'],
  ])('formats national digits %j as %j', (digits, expected) => {
    expect(formatAzNational(digits)).toBe(expected);
  });

  it('builds E.164 only for complete valid mobile numbers', () => {
    expect(azDigitsToE164('501234567')).toBe('+994501234567');
    expect(azDigitsToE164('101234567')).toBe('+994101234567');
    expect(azDigitsToE164('50123456')).toBeNull();
    expect(azDigitsToE164('121234567')).toBeNull(); // Baku landline: OTP login needs a mobile
  });
});

describe('Azerbaijani-safe initials', () => {
  it('uppercases dotted and dotless i correctly', () => {
    expect(upperAzSafe('ilkin')).toBe('İLKİN');
    expect(upperAzSafe('ılğar')).toBe('ILĞAR');
    expect(upperAzSafe('şəmsi çələbi')).toBe('ŞƏMSİ ÇƏLƏBİ');
  });

  it('builds initials from first and last name', () => {
    expect(initialsOf('İlkin', 'Əliyev')).toBe('İƏ');
    expect(initialsOf('ilqar', null)).toBe('İ');
    expect(initialsOf('ülvi', 'şükürov')).toBe('ÜŞ');
    expect(initialsOf('  ', undefined)).toBe('');
    expect(initialsOf(null, null)).toBe('');
  });
});

describe('countdown math', () => {
  it('formats mm:ss and h:mm:ss', () => {
    expect(formatCountdown(0)).toBe('00:00');
    expect(formatCountdown(42)).toBe('00:42');
    expect(formatCountdown(60)).toBe('01:00');
    expect(formatCountdown(299)).toBe('04:59');
    expect(formatCountdown(3600)).toBe('1:00:00');
    expect(formatCountdown(3725)).toBe('1:02:05');
    expect(formatCountdown(-5)).toBe('00:00');
    expect(formatCountdown(12.9)).toBe('00:12');
  });

  it('corrects for the server clock offset', () => {
    const now = Date.parse('2026-10-25T10:00:00.000Z');
    const deadline = '2026-10-25T10:00:30.000Z';
    expect(countdownSeconds(deadline, 0, now)).toBe(30);
    // Server is 5 s ahead of the device: only 25 s are really left.
    expect(countdownSeconds(deadline, 5_000, now)).toBe(25);
    // Server is 5 s behind: 35 s left.
    expect(countdownSeconds(deadline, -5_000, now)).toBe(35);
  });

  it('rounds partial seconds up and never goes negative', () => {
    const now = Date.parse('2026-10-25T10:00:00.000Z');
    expect(countdownSeconds('2026-10-25T10:00:00.400Z', 0, now)).toBe(1);
    expect(countdownSeconds('2026-10-25T10:00:00.000Z', 0, now)).toBe(0);
    expect(countdownSeconds('2026-10-25T09:59:00.000Z', 0, now)).toBe(0);
    expect(countdownSeconds(now + 10_000, 0, now)).toBe(10);
  });

  it('computes progress of a window', () => {
    expect(countdownProgress(30, 30)).toBe(1);
    expect(countdownProgress(15, 30)).toBe(0.5);
    expect(countdownProgress(0, 30)).toBe(0);
    expect(countdownProgress(40, 30)).toBe(1);
    expect(countdownProgress(5, 0)).toBe(0);
  });

  it('derives the clock offset from serverNow', () => {
    expect(computeClockOffset('2026-10-25T10:00:05.000Z', Date.parse('2026-10-25T10:00:00.000Z'))).toBe(5000);
    expect(computeClockOffset('garbage', 0)).toBeNull();
    clockStore.getState().syncWithServer('2026-10-25T10:00:05.000Z', Date.parse('2026-10-25T10:00:00.000Z'));
    expect(clockStore.getState().offsetMs).toBe(5000);
    expect(serverNow(1000)).toBe(6000);
    clockStore.getState().syncWithServer('not a date');
    expect(clockStore.getState().offsetMs).toBe(5000);
    clockStore.getState().reset();
    expect(clockStore.getState().offsetMs).toBe(0);
  });
});

describe('keypad amount entry', () => {
  const press = (keys: KeypadKey[], start = '') => keys.reduce((v, k) => applyKeypadKey(v, k), start);

  it('types amounts with up to two decimals', () => {
    expect(press(['3', '5'])).toBe('35');
    expect(press(['4', '5', '.', '5', '0'])).toBe('45.50');
    expect(press(['4', '5', '.', '5', '0', '9'])).toBe('45.50');
    expect(press(['.', '5'])).toBe('0.5');
  });

  it('ignores a second decimal point and leading zeros', () => {
    expect(press(['1', '.', '.', '2'])).toBe('1.2');
    expect(press(['0', '0', '7'])).toBe('7');
    expect(press(['0', '.', '5'])).toBe('0.5');
  });

  it('caps integer digits and supports backspace', () => {
    expect(press(['1', '2', '3', '4', '5', '6', '7'])).toBe('123456');
    expect(press(['1', '2', 'back'])).toBe('1');
    expect(press(['back'])).toBe('');
    expect(applyKeypadKey('9', '9', { maxIntDigits: 1 })).toBe('9');
    expect(applyKeypadKey('9', '.', { decimals: 0 })).toBe('9');
  });

  it('converts to and from integer qəpik without floats', () => {
    expect(keypadToMinor('')).toBe(0);
    expect(keypadToMinor('.')).toBe(0);
    expect(keypadToMinor('35')).toBe(3500);
    expect(keypadToMinor('45.5')).toBe(4550);
    expect(keypadToMinor('0.1')).toBe(10);
    expect(keypadToMinor('12.')).toBe(1200);
    expect(keypadToMinor('19.99')).toBe(1999);
    expect(minorToKeypad(0)).toBe('');
    expect(minorToKeypad(1200)).toBe('12');
    expect(minorToKeypad(450)).toBe('4.5');
    expect(minorToKeypad(405)).toBe('4.05');
    expect(minorToKeypad(1999)).toBe('19.99');
  });
});

describe('money rendering (shared formatter used by <Money>)', () => {
  it('formats qəpik per locale', () => {
    expect(formatMoney(4500, 'az')).toBe('45,00 ₼');
    expect(formatMoney(123450, 'ru')).toBe('1 234,50 ₼');
    expect(formatMoney(-1000, 'en')).toBe('-₼10.00');
    expect(formatMoney(5000, 'az', { sign: true, compact: true })).toBe('+50 ₼');
  });
});
