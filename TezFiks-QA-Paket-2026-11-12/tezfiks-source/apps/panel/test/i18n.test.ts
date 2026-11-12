import { describe, expect, it } from 'vitest';
import { createTranslator } from 'next-intl';
import { resources } from '@tezfiks/i18n';
import { LOCALES } from '@tezfiks/shared';
import { i18nextToIcu, panelMessages, toIcuMessages } from '@/i18n/messages';
import { resolveLocale } from '@/i18n/config';
import { ADMIN_NAV, companyNav } from '@/lib/nav';
import { STATUS_FAMILIES, statusPresentation, type StatusFamily } from '@/lib/status';

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** Strict translator: missing keys and ICU syntax errors throw instead of being logged. */
function translator(locale: string, messages: Record<string, unknown> = panelMessages(locale)): Translate {
  return createTranslator({
    locale,
    messages: messages as never,
    onError: (err) => {
      throw err;
    },
  }) as unknown as Translate;
}

describe('i18next -> ICU conversion', () => {
  it('turns {{var}} into {var}', () => {
    expect(i18nextToIcu('Kod {{phone}} nömrəsinə göndərildi')).toBe('Kod {phone} nömrəsinə göndərildi');
    expect(i18nextToIcu('{{ a }} və {{b}}')).toBe('{a} və {b}');
  });

  it('quotes ICU syntax characters in literal text', () => {
    expect(i18nextToIcu("it's")).toBe("it''s");
    expect(i18nextToIcu('a {b} <c>')).toBe("a '{'b'}' '<'c>");
  });

  it('builds plural messages from _one/_few/_many/_other keys', () => {
    expect(
      toIcuMessages({
        minutes_one: '{{count}} минута',
        minutes_few: '{{count}} минуты',
        minutes_many: '{{count}} минут',
        minutes_other: '{{count}} минуты',
      }),
    ).toEqual({
      minutes: '{count, plural, one {# минута} few {# минуты} many {# минут} other {# минуты}}',
    });
  });

  it('keeps nested groups and non-plural keys', () => {
    expect(toIcuMessages({ a: { b: 'x {{n}}' }, only_one: 'single' })).toEqual({
      a: { b: 'x {n}' },
      only_one: 'single',
    });
  });

  it('formats real shared messages in every language', () => {
    expect(translator('ru')('common.units.minutes', { count: 3 })).toBe('3 минуты');
    expect(translator('ru')('common.units.minutes', { count: 5 })).toBe('5 минут');
    expect(translator('en')('common.units.minutes', { count: 1 })).toBe('1 min');
    expect(translator('az')('common.units.minutes', { count: 12 })).toBe('12 dəq');
    expect(translator('az')('panel.auth.codeSentTo', { phone: '+994 50 123 45 67' })).toBe(
      'Kod WhatsApp-da +994 50 123 45 67 nömrəsinə göndərildi',
    );
    expect(translator('az')('common.errors.NOT_FOUND')).toBe('Tapılmadı');
  });

  it('the strict translator really fails on missing keys and broken ICU', () => {
    expect(() => translator('az')('panel.doesNotExist')).toThrow();
    const broken = translator('az', { x: '{count, plural, one {#}' });
    expect(() => broken('x', { count: 1 })).toThrow();
  });

  it('defaults to az for missing or unknown locale cookies', () => {
    expect(resolveLocale(undefined)).toBe('az');
    expect(resolveLocale('de')).toBe('az');
    expect(resolveLocale('ru')).toBe('ru');
    expect(resolveLocale('en-US')).toBe('en');
  });

  it('can format every message of the panel and common namespaces (valid ICU in az, ru and en)', () => {
    const sample = {
      count: 2,
      phone: '+994501234567',
      seconds: 30,
      code: '123456',
      company: 'Usta MMC',
      role: 'Usta',
      date: '01.11.2026',
      page: 2,
      name: 'Aysel',
      value: 3,
      // Placeholders of the admin pages (lane P1): sample data only, every message must still format.
      min: 3,
      max: 500,
      delta: '+12%',
      orders: 142,
      fee: '10 ₼',
      number: '#2847',
      filled: 1,
      requested: 2,
      step: 1,
      ring: 2,
      km: '1.5',
      amount: '15,00 ₼',
      minutes: 7,
      actor: 'admin',
      version: '2026-10',
      locale: 'az',
      voen: '1234567890',
      total: '100 ₼',
      rate: 18,
      email: 'admin@tezfiks.az',
      workers: 3,
      days: 5,
      percent: 40,
      lat: '40.40930',
      lng: '49.86710',
    };
    for (const locale of LOCALES) {
      const t = translator(locale);
      const walk = (tree: Record<string, unknown>, prefix: string) => {
        for (const [k, v] of Object.entries(tree)) {
          const key = `${prefix}.${k}`;
          if (typeof v === 'string') expect(() => t(key, sample), `${locale}:${key}`).not.toThrow();
          else walk(v as Record<string, unknown>, key);
        }
      };
      const messages = panelMessages(locale);
      walk(messages.common as Record<string, unknown>, 'common');
      walk(messages.panel as Record<string, unknown>, 'panel');
    }
  });
});

describe('translations used by the shell', () => {
  it('has a label for every admin and company nav item in every language', () => {
    for (const locale of LOCALES) {
      const panel = resources[locale].panel as {
        nav: { admin: Record<string, string>; company: Record<string, string> };
      };
      for (const item of ADMIN_NAV)
        expect(panel.nav.admin[item.id], `${locale} admin ${item.id}`).toBeTruthy();
      for (const item of companyNav('c'))
        expect(panel.nav.company[item.id], `${locale} company ${item.id}`).toBeTruthy();
    }
  });

  it('uses the board 05 Azerbaijani labels for the admin sidebar', () => {
    const t = translator('az');
    expect(ADMIN_NAV.map((i) => t(`panel.nav.admin.${i.id}`))).toEqual([
      'Dashboard',
      'Sifarişlər',
      'Ustalar',
      'Şirkətlər',
      'Müştərilər',
      'Ödənişlər',
      'Müraciətlər',
      'Layihələr',
      'Kateqoriyalar',
      'Xəritə',
      'Tənzimləmələr',
      'Audit',
      'Demo',
    ]);
  });

  it('has a translated label for every status value of every family in every language', () => {
    for (const locale of LOCALES) {
      const t = translator(locale);
      for (const family of Object.keys(STATUS_FAMILIES) as StatusFamily[]) {
        for (const status of STATUS_FAMILIES[family]) {
          const { labelKey } = statusPresentation(family, status);
          const text = t(labelKey);
          expect(text, `${locale} ${labelKey}`).not.toBe(labelKey);
          expect(text.length).toBeGreaterThan(0);
        }
      }
    }
  });
});
