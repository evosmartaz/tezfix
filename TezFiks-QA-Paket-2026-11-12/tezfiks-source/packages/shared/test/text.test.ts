import { describe, expect, it } from 'vitest';
import { shortName, tzFold, upperAz } from '../src/text';

describe('text', () => {
  it('folds Azerbaijani letters including dotted and dotless i', () => {
    expect(tzFold('İsmayıl')).toBe('ismayil');
    expect(tzFold('ISMAYIL')).toBe('ismayil');
    expect(tzFold('Əli Şükürov')).toBe('eli sukurov');
    expect(tzFold('Çağırış Öyrən')).toBe('cagiris oyren');
  });
  it('uppercases az correctly and shortens names', () => {
    expect(upperAz('istilik')).toBe('İSTİLİK');
    expect(shortName('Nizami', 'Talıbov')).toBe('Nizami T.');
    expect(shortName('Aysel', null)).toBe('Aysel');
  });
});
