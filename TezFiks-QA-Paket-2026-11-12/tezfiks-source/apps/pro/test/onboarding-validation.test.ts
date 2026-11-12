import {
  clampRadius,
  COMPANY_RADIUS,
  groupTrades,
  sanitizeVoen,
  SOLO_RADIUS,
  toggleTrade,
  validateCompanyForm,
  validateSoloForm,
  type CompanyForm,
  type SoloForm,
} from '../src/lib/onboarding';
import { CATEGORIES } from './fixtures';

const BASE = { lat: 40.4093, lng: 49.8671 };

const solo = (over: Partial<SoloForm> = {}): SoloForm => ({
  firstName: 'İsmayıl',
  lastName: 'Şükürov',
  photoFileId: null,
  tradeIds: ['00000000-0000-4000-8000-0000000000c1'],
  radiusKm: 10,
  base: BASE,
  ...over,
});

const company = (over: Partial<CompanyForm> = {}): CompanyForm => ({
  firstName: 'Aysel',
  lastName: 'Qasımova',
  name: 'FixPro MMC',
  legalForm: 'MMC',
  voen: '1234567890',
  isVatPayer: true,
  tradeIds: ['00000000-0000-4000-8000-0000000000c3'],
  radiusKm: 15,
  base: BASE,
  baseAddress: 'Xətai r., M.Hadi küç. 12',
  ...over,
});

describe('solo onboarding validation', () => {
  it('builds the POST /pro/onboarding/solo body with Azerbaijani names intact', () => {
    const r = validateSoloForm(solo({ firstName: '  İsmayıl ', photoFileId: '00000000-0000-4000-8000-0000000000f1', tradeIds: ['00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000c1'] }));
    expect(r.errors).toEqual({});
    expect(r.body).toEqual({
      firstName: 'İsmayıl',
      lastName: 'Şükürov',
      photoFileId: '00000000-0000-4000-8000-0000000000f1',
      tradeIds: ['00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000c2'],
      serviceRadiusKm: 10,
      base: BASE,
    });
  });

  it('requires names, at least one trade, a radius of 2–25 km and a base location', () => {
    const r = validateSoloForm(solo({ firstName: ' ', lastName: '', tradeIds: [], radiusKm: 26, base: null }));
    expect(r.body).toBeNull();
    expect(r.errors).toEqual({
      firstName: 'onboarding.errors.firstNameRequired',
      lastName: 'onboarding.errors.lastNameRequired',
      trades: 'onboarding.errors.tradesRequired',
      radius: 'onboarding.errors.radius',
      base: 'onboarding.errors.baseRequired',
    });
    expect(validateSoloForm(solo({ radiusKm: 1 })).errors.radius).toBe('onboarding.errors.radius');
    expect(validateSoloForm(solo({ radiusKm: 2 })).body?.serviceRadiusKm).toBe(2);
    expect(validateSoloForm(solo({ radiusKm: 25 })).body?.serviceRadiusKm).toBe(25);
    expect(validateSoloForm(solo({ base: { lat: 0, lng: 0 } })).errors.base).toBe('onboarding.errors.baseRequired');
  });

  it('limits trades to 15 and names to 60 characters', () => {
    const many = Array.from({ length: 16 }, (_, i) => `t${i}`);
    expect(validateSoloForm(solo({ tradeIds: many })).errors.trades).toBe('onboarding.errors.tradesTooMany');
    expect(validateSoloForm(solo({ firstName: 'a'.repeat(61) })).errors.firstName).toBe('onboarding.errors.nameTooLong');
    expect(toggleTrade(Array.from({ length: 15 }, (_, i) => `t${i}`), 'x', 15)).toHaveLength(15);
    expect(toggleTrade(['a', 'b'], 'a', 15)).toEqual(['b']);
    expect(toggleTrade(['a'], 'b', 15)).toEqual(['a', 'b']);
  });

  it('clamps the radius slider', () => {
    expect(clampRadius(1, SOLO_RADIUS)).toBe(2);
    expect(clampRadius(12.6, SOLO_RADIUS)).toBe(13);
    expect(clampRadius(40, SOLO_RADIUS)).toBe(25);
    expect(clampRadius(40, COMPANY_RADIUS)).toBe(40);
    expect(clampRadius(Number.NaN, SOLO_RADIUS)).toBe(2);
  });
});

describe('company registration validation', () => {
  it('builds the POST /pro/onboarding/company body', () => {
    const r = validateCompanyForm(company());
    expect(r.errors).toEqual({});
    expect(r.body).toEqual({
      firstName: 'Aysel',
      lastName: 'Qasımova',
      company: {
        name: 'FixPro MMC',
        legalForm: 'MMC',
        voen: '1234567890',
        isVatPayer: true,
        tradeIds: ['00000000-0000-4000-8000-0000000000c3'],
        serviceRadiusKm: 15,
        base: BASE,
        baseAddress: 'Xətai r., M.Hadi küç. 12',
      },
    });
  });

  it('omits an empty base address', () => {
    expect(validateCompanyForm(company({ baseAddress: '  ' })).body?.company).not.toHaveProperty('baseAddress');
  });

  it('requires a 10-digit VÖEN, a company name and trades', () => {
    const r = validateCompanyForm(company({ voen: '12345', name: 'F', tradeIds: [] }));
    expect(r.body).toBeNull();
    expect(r.errors).toMatchObject({
      voen: 'onboarding.errors.voen',
      name: 'onboarding.errors.companyNameRequired',
      trades: 'onboarding.errors.tradesRequired',
    });
    expect(sanitizeVoen('12 34-567 890 11')).toBe('1234567890');
    expect(validateCompanyForm(company({ radiusKm: 50 })).body?.company.serviceRadiusKm).toBe(50);
    expect(validateCompanyForm(company({ radiusKm: 51 })).errors.radius).toBe('onboarding.errors.radius');
  });
});

describe('trade picker grouping and search', () => {
  it('groups active services under their group in sort order', () => {
    const groups = groupTrades(CATEGORIES);
    expect(groups.map((g) => g.name)).toEqual(['Santexnika', 'Elektrik']);
    expect(groups[0]!.items.map((c) => c.id)).toEqual(['00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000c2']);
    expect(groups[1]!.items.map((c) => c.id)).toEqual(['00000000-0000-4000-8000-0000000000c3']); // inactive service hidden
  });

  it('folds Azerbaijani letters when searching (deyisimi finds dəyişimi) and matches keywords', () => {
    expect(groupTrades(CATEGORIES, 'deyisimi').flatMap((g) => g.items.map((c) => c.id))).toEqual(['00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000c3']);
    expect(groupTrades(CATEGORIES, 'SU').flatMap((g) => g.items.map((c) => c.id))).toEqual(['00000000-0000-4000-8000-0000000000c1']);
    expect(groupTrades(CATEGORIES, 'elektrik').flatMap((g) => g.items.map((c) => c.id))).toEqual(['00000000-0000-4000-8000-0000000000c3']);
  });
});
