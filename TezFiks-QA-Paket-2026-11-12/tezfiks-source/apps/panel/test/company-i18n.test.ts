import { describe, expect, it } from 'vitest';
import { createTranslator } from 'next-intl';
import { panelMessages } from '@/i18n/messages';

function tr(locale: string, namespace: string) {
  return createTranslator({ locale, messages: panelMessages(locale), namespace: namespace as never }) as unknown as (
    key: string,
    values?: Record<string, unknown>,
  ) => string;
}

describe('company panel messages', () => {
  it('count messages agree with the number in every language', () => {
    const en = tr('en', 'panel.company');
    expect(en('dashboard.openDispatchWaiting', { count: 1 })).toBe('Dispatch: 1 new order');
    expect(en('dashboard.openDispatchWaiting', { count: 3 })).toBe('Dispatch: 3 new orders');
    expect(en('dispatch.offers.accepted', { count: 1, number: '#2851' })).toBe('Order #2851 accepted: 1 handyman sent');
    expect(en('dispatch.offers.accepted', { count: 2, number: '#2851' })).toBe('Order #2851 accepted: 2 handymen sent');
    expect(en('balance.earnings.card', { count: 1, amount: '₼10.00' })).toBe('Card: 1 job, ₼10.00');
    const ru = tr('ru', 'panel.company');
    expect(ru('dashboard.openDispatchWaiting', { count: 1 })).toBe('Диспетчерская: 1 новый заказ');
    expect(ru('dashboard.openDispatchWaiting', { count: 2 })).toBe('Диспетчерская: 2 новых заказа');
    expect(ru('dashboard.openDispatchWaiting', { count: 5 })).toBe('Диспетчерская: 5 новых заказов');
    expect(ru('balance.earnings.cash', { count: 21, amount: '10 ₼' })).toBe('Наличными: 21 работа, 10 ₼');
    const az = tr('az', 'panel.company');
    expect(az('dashboard.openDispatchWaiting', { count: 4 })).toBe('Dispetçer: 4 yeni sifariş');
  });

  it('board 04 texts in Azerbaijani', () => {
    const az = tr('az', 'panel.company');
    expect(az('dispatch.offers.feeNote', { amount: '10 ₼' })).toBe('Qəbulda şirkət balansından 10 ₼ tutulacaq');
    expect(az('dispatch.offers.pickTitle')).toBe('Ustanı seçin');
    expect(az('dispatch.offers.accept')).toBe('Qəbul et və göndər');
    expect(az('workerState.free')).toBe('Boşdur');
    expect(az('workerState.busy')).toBe('Sifarişdədir');
    expect(az('settings.finalPrice.title')).toBe('Yekun qiyməti kim daxil edir?');
  });

  it('literal apostrophes and percent signs survive the ICU conversion', () => {
    expect(tr('en', 'panel.company.orders')('contactLocked')).toBe("The customer's phone unlocks when the handyman is close.");
    expect(tr('az', 'panel.company.projects.invoice')('vat', { rate: 18 })).toBe('ƏDV (18%)');
    expect(tr('az', 'panel.company.projects')('number', { number: 120 })).toBe('#120');
  });
});
