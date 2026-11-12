import fs from 'node:fs';
import path from 'node:path';
import * as Localization from 'expo-localization';
import { resources } from '@tezfiks/i18n';
import { changeLanguage, currentLocale, detectDeviceLanguage, i18n, initI18n, resolveInitialLanguage } from '../src/i18n';
import { createMemoryStorage, STORAGE_KEYS } from '../src/storage';

const getLocales = Localization.getLocales as jest.Mock;

function lookup(obj: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d: fs.Dirent) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? sourceFiles(p) : /\.tsx?$/.test(d.name) ? [p] : [];
  });
}

describe('i18n', () => {
  beforeAll(async () => {
    await initI18n({ appNamespace: 'customer', storage: createMemoryStorage(), language: 'az' });
  });

  afterEach(async () => {
    await i18n.changeLanguage('az');
  });

  it('defaults to Azerbaijani with the app namespace first and common as fallback', () => {
    expect(currentLocale()).toBe('az');
    expect(i18n.t('auth.otpTitle')).toBe('Təsdiq kodu');
    expect(i18n.t('actions.continue')).toBe('Davam et');
    expect(i18n.t('common:errors.OTP_INVALID')).toBe('Kod yanlışdır');
    expect(i18n.t('auth.resendIn', { time: '00:42' })).toBe('Kodu yenidən göndər (00:42)');
  });

  it('switches language and pluralizes Russian with Intl.PluralRules', async () => {
    await i18n.changeLanguage('ru');
    expect(currentLocale()).toBe('ru');
    expect(i18n.t('auth.otpTitle')).toBe('Код подтверждения');
    expect(i18n.t('common:units.minutes', { count: 1 })).toBe('1 минута');
    expect(i18n.t('common:units.minutes', { count: 3 })).toBe('3 минуты');
    expect(i18n.t('common:units.minutes', { count: 5 })).toBe('5 минут');
    await i18n.changeLanguage('en');
    expect(i18n.t('common:units.minutes', { count: 1 })).toBe('1 min');
  });

  it('detects the device language and falls back to az', () => {
    getLocales.mockReturnValueOnce([{ languageCode: 'ru' }]);
    expect(detectDeviceLanguage()).toBe('ru');
    getLocales.mockReturnValueOnce([{ languageCode: 'de' }, { languageCode: 'en' }]);
    expect(detectDeviceLanguage()).toBe('en');
    getLocales.mockReturnValueOnce([{ languageCode: 'de' }]);
    expect(detectDeviceLanguage()).toBe('az');
    getLocales.mockImplementationOnce(() => {
      throw new Error('native module missing');
    });
    expect(detectDeviceLanguage()).toBe('az');
  });

  it('a saved language wins over the device language', async () => {
    getLocales.mockReturnValue([{ languageCode: 'ru' }]);
    await expect(resolveInitialLanguage(createMemoryStorage({ [STORAGE_KEYS.language]: 'en' }))).resolves.toBe('en');
    await expect(resolveInitialLanguage(createMemoryStorage({ [STORAGE_KEYS.language]: 'xx' }))).resolves.toBe('ru');
    await expect(resolveInitialLanguage(createMemoryStorage())).resolves.toBe('ru');
    getLocales.mockReturnValue([{ languageCode: 'az' }]);
  });

  it('changeLanguage persists the choice', async () => {
    const storage = createMemoryStorage();
    await changeLanguage('en', storage);
    expect(storage.data.get(STORAGE_KEYS.language)).toBe('en');
    expect(i18n.t('auth.verify')).toBe('Verify');
  });

  it('every key used by the shared mobile code exists in common, customer.json and pro.json for az, ru and en', () => {
    const root = path.join(__dirname, '..', 'src');
    const keys = new Set<string>();
    for (const file of sourceFiles(root)) {
      const text = fs.readFileSync(file, 'utf8');
      for (const m of text.matchAll(/\bt\(\s*'([A-Za-z]+(?::[A-Za-z]+)?\.[A-Za-z0-9_.]+)'/g)) keys.add(m[1]);
    }
    expect(keys.size).toBeGreaterThan(10);
    const missing: string[] = [];
    for (const lng of ['az', 'ru', 'en'] as const) {
      for (const key of keys) {
        if (key.startsWith('common:')) {
          if (typeof lookup(resources[lng].common, key.slice(7)) !== 'string') missing.push(`${lng} ${key}`);
          continue;
        }
        for (const ns of ['customer', 'pro'] as const) {
          const hit = lookup(resources[lng][ns], key) ?? lookup(resources[lng].common, key);
          if (typeof hit !== 'string') missing.push(`${lng} ${ns}:${key}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
