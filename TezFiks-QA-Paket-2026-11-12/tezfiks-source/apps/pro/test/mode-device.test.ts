import { batteryBrand, batteryGuideKey } from '../src/lib/device';
import { canSwitchMode, parseMode, resolveMode, serializeMode } from '../src/lib/mode';
import { profileResponse } from './fixtures';

const CO = { id: 'co1', name: 'FixPro MMC', status: 'APPROVED' as const, role: 'MANAGER' as const };
const CO2 = { id: 'co2', name: 'Usta Park', status: 'DRAFT' as const, role: 'MANAGER' as const };

describe('manager mode entry', () => {
  it('a solo handyman without companies is always personal and sees no switch', () => {
    const p = profileResponse();
    expect(resolveMode(p, { kind: 'company', companyId: 'co1' })).toEqual({ kind: 'personal' });
    expect(canSwitchMode(p)).toBe(false);
  });

  it('a handyman who manages a company switches between personal and company mode', () => {
    const p = profileResponse({ managedCompanies: [CO] });
    expect(canSwitchMode(p)).toBe(true);
    expect(resolveMode(p, null)).toEqual({ kind: 'personal' });
    expect(resolveMode(p, { kind: 'company', companyId: 'co1' })).toEqual({ kind: 'company', companyId: 'co1' });
    expect(resolveMode(p, { kind: 'company', companyId: 'gone' })).toEqual({ kind: 'personal' });
  });

  it('a manager without a handyman profile is always in company mode', () => {
    const p = profileResponse({ profile: null, managedCompanies: [CO, CO2] });
    expect(resolveMode(p, null)).toEqual({ kind: 'company', companyId: 'co1' });
    expect(resolveMode(p, { kind: 'personal' })).toEqual({ kind: 'company', companyId: 'co1' });
    expect(resolveMode(p, { kind: 'company', companyId: 'co2' })).toEqual({ kind: 'company', companyId: 'co2' });
    expect(canSwitchMode(p)).toBe(true);
    expect(canSwitchMode(profileResponse({ profile: null, managedCompanies: [CO] }))).toBe(false);
  });

  it('serializes the preference', () => {
    expect(parseMode(serializeMode({ kind: 'company', companyId: 'co1' }))).toEqual({ kind: 'company', companyId: 'co1' });
    expect(parseMode(serializeMode({ kind: 'personal' }))).toEqual({ kind: 'personal' });
    expect(parseMode('garbage')).toBeNull();
  });
});

describe('battery optimization guidance per manufacturer', () => {
  it.each([
    ['samsung', null, 'samsung'],
    ['Xiaomi', 'Redmi', 'xiaomi'],
    ['POCO', null, 'xiaomi'],
    ['HUAWEI', null, 'huawei'],
    ['HONOR', null, 'huawei'],
    ['OnePlus', null, 'oneplus'],
    ['realme', null, 'oppo'],
    ['vivo', null, 'vivo'],
    ['Google', 'google', 'google'],
    ['Nokia', null, 'generic'],
    [null, null, 'generic'],
  ])('%s/%s → %s', (manufacturer, brand, expected) => {
    expect(batteryBrand(manufacturer, brand)).toBe(expected);
    expect(batteryGuideKey(manufacturer, brand)).toBe(`device.battery.${expected}`);
  });
});
