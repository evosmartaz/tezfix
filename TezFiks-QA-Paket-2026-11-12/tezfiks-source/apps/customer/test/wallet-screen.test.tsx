import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import path from 'node:path';
import { IDS, account } from './fixtures';
import { M3, intent, tx, wallet } from './fixtures-m3';
import { secureStore } from './helpers';
import { fail, ok, on, resetApp, signedInCustomer, type Handler } from './screen-helpers';
import { nb } from './text';

const APP_DIR = path.join(__dirname, '..', 'src', 'app');
const CHECKOUT_URL = `http://10.0.2.2:3000/tezfix/api/pay/checkout/${M3.intent}?t=signed`;
const browser = () => (require('expo-web-browser') as { openAuthSessionAsync: jest.Mock }).openAuthSessionAsync;

const GEO = { lat: 40.4093, lng: 49.8671, formatted: 'Atatürk pr. 45, Bakı', placeId: null, district: 'Nərimanov', street: 'Atatürk pr.', building: '45' };

function setup(opts: { w?: ReturnType<typeof wallet>; pages?: Record<string, { items: unknown[]; nextCursor: string | null }>; extra?: Handler[]; acc?: ReturnType<typeof account> } = {}) {
  const state = { w: opts.w ?? wallet(), payment: intent({ purpose: 'WALLET_TOPUP', amount: 2000, status: 'CREATED', checkoutUrl: CHECKOUT_URL }) };
  const pages = opts.pages ?? { first: { items: [tx()], nextCursor: null } };
  const api = signedInCustomer({
    account: opts.acc,
    extra: [
      ...(opts.extra ?? []),
      on('GET', '/wallet', () => ok(state.w)),
      on('GET', '/wallet/transactions', (c) => ok(pages[c.query.cursor ?? 'first'])),
      on('GET', '/payments/:id', () => ok(state.payment)),
      on('POST', '/wallet/topup', () => ok({ paymentIntentId: M3.intent, checkoutUrl: CHECKOUT_URL })),
    ],
  });
  return { api, state };
}

describe('wallet tab', () => {
  beforeEach(() => {
    resetApp();
    browser().mockReset();
    browser().mockResolvedValue({ type: 'cancel' });
  });

  it('shows the posted balance, available and held amounts and the history with signed amounts', async () => {
    setup({
      pages: {
        first: {
          items: [
            tx({ id: M3.tx2, kind: 'EMERGENCY_FEE_CAPTURE', amount: -500, balanceAfter: 1500, requestNumber: 1042, createdAt: '2026-10-25T10:00:00.000Z' }),
            tx(),
          ],
          nextCursor: 'c2',
        },
        c2: { items: [tx({ id: 'old', kind: 'CANCEL_PENALTY', amount: -1500, balanceAfter: 2000 })], nextCursor: null },
      },
    });
    await renderRouter(APP_DIR, { initialUrl: '/wallet' });
    await waitFor(() => expect(screen.getByTestId('wallet-balance')).toBeTruthy());
    expect(screen.getByTestId('wallet-posted').props.children).toBe(nb('20,00 ₼'));
    expect(screen.getByText('İstifadəyə yararlı: 15,00 ₼')).toBeTruthy();
    expect(screen.getByText('Bloklanıb: 5,00 ₼')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId(`wallet-tx-${M3.tx2}`)).toBeTruthy());
    expect(within(screen.getByTestId(`wallet-tx-${M3.tx2}`)).getByText('Təcili sifariş haqqı')).toBeTruthy();
    expect(screen.getByTestId(`wallet-tx-amount-${M3.tx2}`).props.children).toBe(nb('-5,00 ₼'));
    expect(screen.getByTestId(`wallet-tx-amount-${M3.tx}`).props.children).toBe(nb('+20,00 ₼'));
    expect(within(screen.getByTestId(`wallet-tx-${M3.tx2}`)).getByText(/Sifariş #1042/)).toBeTruthy();
    await fireEvent(screen.getByTestId('wallet-list'), 'endReached');
    await waitFor(() => expect(screen.getByTestId('wallet-tx-old')).toBeTruthy());
    expect(within(screen.getByTestId('wallet-tx-old')).getByText('Ləğv cəriməsi')).toBeTruthy();
  });

  it('a debt shows the red balance and the debt banner; the top-up suggests the debt amount', async () => {
    setup({ w: wallet({ posted: -1500, held: 0, available: -1500, isDebt: true, lowBalance: true }) });
    await renderRouter(APP_DIR, { initialUrl: '/wallet' });
    await waitFor(() => expect(screen.getByTestId('wallet-debt')).toBeTruthy());
    expect(screen.getByText('Borc: 15,00 ₼. Yeni sifariş üçün balansı artırın')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('wallet-topup'));
    await waitFor(() => expect(screen.getByTestId('topup-sheet')).toBeTruthy());
    expect(screen.getByTestId('topup-amount-custom').props.value).toBe('15');
  });

  it('top-up: preset → POST /wallet/topup with the app return URL → checkout → success, balance refreshed', async () => {
    const { api, state } = setup();
    browser().mockImplementation(async () => {
      state.payment = intent({ purpose: 'WALLET_TOPUP', amount: 5000, status: 'SUCCEEDED' });
      state.w = wallet({ posted: 7000, available: 6500 });
      return { type: 'success', url: `tezfiks://payment?paymentIntentId=${M3.intent}&status=SUCCEEDED` };
    });
    await renderRouter(APP_DIR, { initialUrl: '/wallet' });
    await waitFor(() => expect(screen.getByTestId('wallet-topup')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('wallet-topup'));
    await fireEvent.press(screen.getByTestId('topup-amount-preset-5000'));
    expect(screen.getByText('50,00 ₼ ödə')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('topup-pay'));
    await waitFor(() => expect(screen.getByText('Balans 50,00 ₼ artırıldı')).toBeTruthy());
    const call = api.find('POST', '/wallet/topup')[0];
    expect(call.body).toEqual({ amount: 5000, returnUrl: 'tezfiks://payment' });
    expect(call.headers['Idempotency-Key']).toBeTruthy();
    expect(browser()).toHaveBeenCalledWith(CHECKOUT_URL, 'tezfiks://payment');
    await waitFor(() => expect(screen.getByTestId('wallet-posted').props.children).toBe(nb('70,00 ₼')));
  });

  it('a declined test card keeps the sheet open with the error', async () => {
    const { state } = setup();
    browser().mockImplementation(async () => {
      state.payment = intent({ purpose: 'WALLET_TOPUP', status: 'FAILED' });
      return { type: 'success', url: `tezfiks://payment?paymentIntentId=${M3.intent}&status=FAILED` };
    });
    await renderRouter(APP_DIR, { initialUrl: '/wallet' });
    await waitFor(() => expect(screen.getByTestId('wallet-topup')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('wallet-topup'));
    await fireEvent.press(screen.getByTestId('topup-pay'));
    await waitFor(() => expect(screen.getByText('Ödəniş alınmadı. Başqa kartla yenidən cəhd edin')).toBeTruthy());
    expect(screen.getByTestId('topup-sheet')).toBeTruthy();
  });

  it('validates the amount before calling the API', async () => {
    const { api } = setup();
    await renderRouter(APP_DIR, { initialUrl: '/wallet' });
    await waitFor(() => expect(screen.getByTestId('wallet-topup')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('wallet-topup'));
    await fireEvent.changeText(screen.getByTestId('topup-amount-custom'), '1500');
    await fireEvent.press(screen.getByTestId('topup-pay'));
    expect(screen.getByText('Maksimum məbləğ 1000 ₼-dir')).toBeTruthy();
    expect(api.find('POST', '/wallet/topup')).toHaveLength(0);
  });

  it('a network error keeps the Idempotency-Key for the retry', async () => {
    let n = 0;
    const { api } = setup({ extra: [on('POST', '/wallet/topup', () => (++n === 1 ? fail(503, 'INTERNAL') : ok({ paymentIntentId: M3.intent, checkoutUrl: CHECKOUT_URL })))] });
    await renderRouter(APP_DIR, { initialUrl: '/wallet' });
    await waitFor(() => expect(screen.getByTestId('wallet-topup')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('wallet-topup'));
    await fireEvent.press(screen.getByTestId('topup-pay'));
    await waitFor(() => expect(api.find('POST', '/wallet/topup')).toHaveLength(1));
    await waitFor(() => expect(screen.getByText('Gözlənilməz xəta baş verdi')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('topup-pay'));
    await waitFor(() => expect(api.find('POST', '/wallet/topup')).toHaveLength(2));
    const [a, b] = api.find('POST', '/wallet/topup');
    expect(a.headers['Idempotency-Key']).toBe(b.headers['Idempotency-Key']);
  });

  it('wallet:updated over the socket refreshes the balance', async () => {
    const { state } = setup();
    await renderRouter(APP_DIR, { initialUrl: '/wallet' });
    await waitFor(() => expect(screen.getByTestId('wallet-posted')).toBeTruthy());
    state.w = wallet({ posted: 500, available: 500, held: 0 });
    const { serverEmit } = require('./screen-helpers') as typeof import('./screen-helpers');
    await serverEmit('wallet:updated', { owner: 'customer', companyId: null, available: 500, posted: 500 });
    await waitFor(() => expect(screen.getByTestId('wallet-posted').props.children).toBe(nb('5,00 ₼')));
  });

  it('Russian wallet texts', async () => {
    setup();
    secureStore().set('tf.language', 'ru');
    await renderRouter(APP_DIR, { initialUrl: '/wallet' });
    await waitFor(() => expect(screen.getByText('История операций')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('+ Пополнить')).toBeTruthy());
  });
});

describe('top-up CTAs open the real wallet top-up', () => {
  beforeEach(() => resetApp());

  it('home debt banner → /wallet with the top-up sheet for the debt', async () => {
    const debt = account({ wallet: { accountId: IDS.wallet, currency: 'AZN', posted: -1500, held: 0, available: -1500, isDebt: true, lowBalance: true } });
    setup({ acc: debt, w: wallet({ posted: -1500, held: 0, available: -1500, isDebt: true }) });
    const r = await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(screen.getByTestId('home-debt-topup')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('home-debt-topup'));
    await waitFor(() => expect(screen.getByTestId('topup-sheet')).toBeTruthy());
    expect(r.getPathname()).toBe('/wallet');
    expect(screen.getByTestId('topup-amount-custom').props.value).toBe('15');
  });

  it('emergency shortfall → top-up sheet with the missing amount', async () => {
    const short = account({ wallet: { accountId: IDS.wallet, currency: 'AZN', posted: 700, held: 0, available: 700, isDebt: false, lowBalance: true } });
    setup({ acc: short, w: wallet({ posted: 700, held: 0, available: 700 }), extra: [on('GET', '/geo/reverse', () => ok(GEO))] });
    const r = await renderRouter(APP_DIR, { initialUrl: `/request/new?categoryId=${IDS.plumbing}` });
    await waitFor(() => expect(screen.getByTestId('request-timing-EMERGENCY')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('request-timing-EMERGENCY'));
    await fireEvent.press(screen.getByTestId('request-slots-inc'));
    await waitFor(() => expect(screen.getByTestId('request-topup')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('request-topup'));
    await waitFor(() => expect(screen.getByTestId('topup-sheet')).toBeTruthy());
    expect(r.getPathname()).toBe('/wallet');
    // 10 AZN needed, 7 available → 3 AZN preselected.
    expect(screen.getByTestId('topup-amount-custom').props.value).toBe('3');
  });

  it('CUSTOMER_IN_DEBT from POST /requests → top-up action', async () => {
    const debt = account({ wallet: { accountId: IDS.wallet, currency: 'AZN', posted: -1500, held: 0, available: -1500, isDebt: true, lowBalance: true } });
    setup({ acc: debt, w: wallet({ posted: -1500, isDebt: true }), extra: [on('GET', '/geo/reverse', () => ok(GEO)), on('POST', '/requests', () => fail(409, 'CUSTOMER_IN_DEBT'))] });
    const r = await renderRouter(APP_DIR, { initialUrl: `/request/new?categoryId=${IDS.plumbing}` });
    await waitFor(() => expect(screen.getByTestId('request-address-text').props.children).toBe('Atatürk pr. 45, Bakı'));
    await fireEvent.changeText(screen.getByTestId('request-description'), 'Kran damcılayır');
    await fireEvent.press(screen.getByTestId('request-submit'));
    await waitFor(() => expect(screen.getByTestId('request-error-topup')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('request-error-topup'));
    await waitFor(() => expect(screen.getByTestId('topup-sheet')).toBeTruthy());
    expect(r.getPathname()).toBe('/wallet');
    expect(screen.getByTestId('topup-amount-custom').props.value).toBe('15');
  });
});
