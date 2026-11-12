import { describe, expect, it } from 'vitest';
import { createTranslator } from 'next-intl';
import { panelMessages } from '@/i18n/messages';

function tr(locale: string, namespace: string) {
  return createTranslator({ locale, messages: panelMessages(locale), namespace: namespace as never }) as unknown as (
    key: string,
    values?: Record<string, unknown>,
  ) => string;
}

/** Count messages of the admin pages agree with the number in every language. */
describe('admin count messages are pluralized', () => {
  it('dashboard fee hint "N sifariş × fee"', () => {
    const ru = tr('ru', 'panel.admin.dashboard');
    expect(ru('revenueHint', { count: 1, fee: '10 ₼' })).toBe('1 заказ × 10 ₼');
    expect(ru('revenueHint', { count: 2, fee: '10 ₼' })).toBe('2 заказа × 10 ₼');
    expect(ru('revenueHint', { count: 5, fee: '10 ₼' })).toBe('5 заказов × 10 ₼');
    expect(ru('revenueHint', { count: 21, fee: '10 ₼' })).toBe('21 заказ × 10 ₼');
    const en = tr('en', 'panel.admin.dashboard');
    expect(en('revenueHint', { count: 1, fee: '₼10' })).toBe('1 order × ₼10');
    expect(en('revenueHint', { count: 142, fee: '₼10' })).toBe('142 orders × ₼10');
    expect(tr('az', 'panel.admin.dashboard')('revenueHint', { count: 1, fee: '10 ₼' })).toBe('1 sifariş × 10 ₼');
  });

  it('completed jobs of a quote provider', () => {
    const en = tr('en', 'panel.admin.projects');
    expect(en('quotes.completed', { count: 1 })).toBe('1 job');
    expect(en('quotes.completed', { count: 3 })).toBe('3 jobs');
    const ru = tr('ru', 'panel.admin.projects');
    expect(ru('quotes.completed', { count: 1 })).toBe('1 работа');
    expect(ru('quotes.completed', { count: 3 })).toBe('3 работы');
    expect(ru('quotes.completed', { count: 11 })).toBe('11 работ');
    expect(tr('az', 'panel.admin.projects')('quotes.completed', { count: 348 })).toBe('348 iş');
  });

  it('English counts of strikes, payouts and bots', () => {
    const en = (ns: string) => tr('en', ns);
    expect(en('panel.admin.handymen.actions')('clearStrikesDescription', { count: 1 })).toBe('1 active strike will be cleared.');
    expect(en('panel.admin.handymen.actions')('clearStrikesDescription', { count: 2 })).toBe('2 active strikes will be cleared.');
    expect(en('panel.admin.payouts')('runResult', { count: 1, total: '₼10.00' })).toBe('1 payout created, total ₼10.00');
    expect(en('panel.admin.payouts')('runResult', { count: 3, total: '₼10.00' })).toBe('3 payouts created, total ₼10.00');
    expect(en('panel.admin.demo.spawn')('done', { count: 1 })).toBe('1 bot spawned');
    expect(en('panel.admin.demo.spawn')('done', { count: 5 })).toBe('5 bots spawned');
  });
});
