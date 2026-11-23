import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import path from 'node:path';
import type { CustomerAssignment } from '@tezfiks/shared';
import { IDS, detail } from './fixtures';
import { M3, completed, intent, priced } from './fixtures-m3';
import { secureStore } from './helpers';
import { fail, ok, on, resetApp, signedInCustomer, type Handler } from './screen-helpers';

const APP_DIR = path.join(__dirname, '..', 'src', 'app');
const BASE = `/assignment/${IDS.assignment}`;
const CHECKOUT_URL = `http://10.0.2.2:3000/tezfix/api/pay/checkout/${M3.intent}?t=signed`;
/** formatMoney separates the amount and ₼ with a no-break space. */
const nb = (text: string) => text.replace(/ ₼/g, '\u00a0₼');
const browser = () => (require('expo-web-browser') as { openAuthSessionAsync: jest.Mock }).openAuthSessionAsync;

function setup(initial: CustomerAssignment, extra: Handler[] = []) {
  const state = { a: initial, payment: intent() };
  const api = signedInCustomer({
    extra: [
      ...extra,
      on('GET', '/assignments/:id', () => ok(state.a)),
      on('GET', '/requests/:id', () => ok(detail({ status: 'IN_PROGRESS', isSearching: false, search: null, assignments: [state.a] }))),
      on('GET', '/payments/:id', () => ok(state.payment)),
    ],
  });
  return { api, state };
}

describe('payment (board 02 C1)', () => {
  beforeEach(() => {
    resetApp();
    browser().mockReset();
    browser().mockResolvedValue({ type: 'cancel' });
  });

  it('shows the agreed price with labour and materials, both methods and the guarantee explainer', async () => {
    setup(priced());
    await renderRouter(APP_DIR, { initialUrl: `${BASE}/pay` });
    await waitFor(() => expect(screen.getByTestId('pay-summary')).toBeTruthy());
    expect(screen.getByTestId('pay-labor').props.children).toBe(nb('35,00 ₼'));
    expect(screen.getByTestId('pay-materials').props.children).toBe(nb('10,00 ₼'));
    expect(screen.getByTestId('pay-total').props.children).toBe(nb('45,00 ₼'));
    expect(screen.getByText('Nağd — qapıda ödəmə')).toBeTruthy();
    expect(screen.getByText('Kartla ödəmə')).toBeTruthy();
    expect(screen.getByText('TezFiks Zəmanəti nədir?')).toBeTruthy();
    expect(screen.getByText('45,00 ₼ ödə')).toBeTruthy();
    // Cash hides the guarantee explainer (no guarantee for cash jobs).
    await fireEvent.press(screen.getByTestId('pay-method-CASH'));
    expect(screen.queryByTestId('pay-guarantee')).toBeNull();
    expect(screen.getByText('45,00 ₼ nağd ödəyirəm')).toBeTruthy();
  });

  it('cash: confirms with method CASH (no checkout) and moves on to the rating', async () => {
    const { api, state } = setup(priced());
    api.use(
      on('POST', '/assignments/:id/confirm-price', () => {
        state.a = completed({ paymentMethod: 'CASH', payment: null, guaranteeUntil: null, actions: { ...completed().actions, tip: false, guaranteeClaim: false } });
        return ok({ assignment: state.a, payment: null });
      }),
    );
    const r = await renderRouter(APP_DIR, { initialUrl: `${BASE}/pay` });
    await waitFor(() => expect(screen.getByTestId('pay-method-CASH')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('pay-method-CASH'));
    await fireEvent.press(screen.getByTestId('pay-submit'));
    await waitFor(() => expect(r.getPathname()).toBe(`${BASE}/rate`));
    const call = api.find('POST', `/assignments/${IDS.assignment}/confirm-price`)[0];
    expect(call.body).toEqual({ method: 'CASH' });
    expect(call.headers['Idempotency-Key']).toBeTruthy();
    expect(browser()).not.toHaveBeenCalled();
  });

  it('card: opens the checkout in an auth session returning to tezfiks://payment, then the tip page', async () => {
    const { api, state } = setup(priced());
    api.use(
      on('POST', '/assignments/:id/confirm-price', () => {
        state.a = priced({ payment: { intentId: M3.intent, status: 'CREATED' } });
        return ok({ assignment: state.a, payment: { paymentIntentId: M3.intent, checkoutUrl: CHECKOUT_URL } });
      }),
    );
    browser().mockImplementation(async () => {
      state.payment = intent({ status: 'SUCCEEDED' });
      state.a = completed();
      return { type: 'success', url: `tezfiks://payment?paymentIntentId=${M3.intent}&status=SUCCEEDED` };
    });
    const r = await renderRouter(APP_DIR, { initialUrl: `${BASE}/pay` });
    await waitFor(() => expect(screen.getByTestId('pay-submit')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('pay-submit'));
    await waitFor(() => expect(r.getPathname()).toBe(`${BASE}/tip`));
    expect(api.find('POST', `/assignments/${IDS.assignment}/confirm-price`)[0].body).toEqual({ method: 'CARD', returnUrl: 'tezfiks://payment' });
    expect(browser()).toHaveBeenCalledWith(CHECKOUT_URL, 'tezfiks://payment');
    expect(api.find('GET', `/payments/${M3.intent}`).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByTestId('tip-screen')).toBeTruthy());
  });

  it('a declined card shows the failure and allows another try', async () => {
    const { api, state } = setup(priced());
    api.use(on('POST', '/assignments/:id/confirm-price', () => ok({ assignment: state.a, payment: { paymentIntentId: M3.intent, checkoutUrl: CHECKOUT_URL } })));
    browser().mockImplementation(async () => {
      state.payment = intent({ status: 'FAILED', failureReason: 'declined' });
      return { type: 'success', url: `tezfiks://payment?paymentIntentId=${M3.intent}&status=FAILED` };
    });
    const r = await renderRouter(APP_DIR, { initialUrl: `${BASE}/pay` });
    await waitFor(() => expect(screen.getByTestId('pay-submit')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('pay-submit'));
    await waitFor(() => expect(screen.getByTestId('pay-notice')).toBeTruthy());
    expect(screen.getByText('Ödəniş alınmadı. Başqa kartla yenidən cəhd edin')).toBeTruthy();
    expect(r.getPathname()).toBe(`${BASE}/pay`);
  });

  it('closing the checkout without paying keeps the payment open and reopens the same checkout next time', async () => {
    const { api, state } = setup(priced());
    api.use(
      on('POST', '/assignments/:id/confirm-price', () => {
        state.a = priced({ payment: { intentId: M3.intent, status: 'CREATED' } });
        state.payment = intent({ status: 'CREATED', checkoutUrl: CHECKOUT_URL });
        return ok({ assignment: state.a, payment: { paymentIntentId: M3.intent, checkoutUrl: CHECKOUT_URL } });
      }),
    );
    await renderRouter(APP_DIR, { initialUrl: `${BASE}/pay` });
    await waitFor(() => expect(screen.getByTestId('pay-submit')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('pay-submit'));
    await waitFor(() => expect(screen.getByText('Ödəniş tamamlanmayıb. Yenidən cəhd edin')).toBeTruthy());
    expect(api.find('POST', `/assignments/${IDS.assignment}/confirm-price`)).toHaveLength(1);
    // Second attempt: the open intent is reused, no second confirm-price.
    await fireEvent.press(screen.getByTestId('pay-submit'));
    await waitFor(() => expect(browser()).toHaveBeenCalledTimes(2));
    expect(api.find('POST', `/assignments/${IDS.assignment}/confirm-price`)).toHaveLength(1);
    expect(browser().mock.calls[1]).toEqual([CHECKOUT_URL, 'tezfiks://payment']);
  });

  it('a network failure on confirm keeps the idempotency key for the retry', async () => {
    let n = 0;
    const { api, state } = setup(priced());
    api.use(
      on('POST', '/assignments/:id/confirm-price', () => {
        n += 1;
        if (n === 1) return fail(503, 'INTERNAL');
        state.a = completed({ paymentMethod: 'CASH' });
        return ok({ assignment: state.a, payment: null });
      }),
    );
    const r = await renderRouter(APP_DIR, { initialUrl: `${BASE}/pay` });
    await waitFor(() => expect(screen.getByTestId('pay-method-CASH')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('pay-method-CASH'));
    await fireEvent.press(screen.getByTestId('pay-submit'));
    await waitFor(() => expect(screen.getByTestId('pay-notice')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('pay-submit'));
    await waitFor(() => expect(r.getPathname()).toBe(`${BASE}/rate`));
    const [a, b] = api.find('POST', `/assignments/${IDS.assignment}/confirm-price`);
    expect(a.headers['Idempotency-Key']).toBe(b.headers['Idempotency-Key']);
  });

  it('without a proposed price the screen explains and offers the way back', async () => {
    setup(completed());
    await renderRouter(APP_DIR, { initialUrl: `${BASE}/pay` });
    await waitFor(() => expect(screen.getByTestId('pay-unavailable')).toBeTruthy());
    expect(screen.getByText('Bu iş artıq ödənilib')).toBeTruthy();
    expect(screen.queryByTestId('pay-submit')).toBeNull();
  });

  it('price dispute: reason required, then PRICE_DISPUTED', async () => {
    const { api, state } = setup(priced());
    api.use(
      on('POST', '/assignments/:id/dispute-price', () => {
        state.a = priced({ status: 'PRICE_DISPUTED', actions: { ...priced().actions, confirmPrice: false, disputePrice: false } });
        return ok(state.a);
      }),
    );
    const r = await renderRouter(APP_DIR, { initialUrl: `${BASE}/pay` });
    await waitFor(() => expect(screen.getByTestId('pay-dispute')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('pay-dispute'));
    await waitFor(() => expect(screen.getByTestId('dispute-screen')).toBeTruthy());
    expect(screen.getByTestId('dispute-text').props.children).toBe(nb('Usta 45,00 ₼ qiymət təklif edib. Razı deyilsinizsə, səbəbi yazın — admin araşdırıb qərar verəcək.'));
    await fireEvent.press(screen.getByTestId('dispute-submit'));
    expect(screen.getByText('Səbəbi ən azı 3 simvolla yazın')).toBeTruthy();
    expect(api.find('POST', `/assignments/${IDS.assignment}/dispute-price`)).toHaveLength(0);
    await fireEvent.changeText(screen.getByTestId('dispute-reason'), 'Əvvəlcədən 30 ₼ razılaşmışdıq');
    await fireEvent.press(screen.getByTestId('dispute-submit'));
    await waitFor(() => expect(r.getPathname()).toBe(BASE));
    expect(api.find('POST', `/assignments/${IDS.assignment}/dispute-price`)[0].body).toEqual({ reason: 'Əvvəlcədən 30 ₼ razılaşmışdıq' });
    await waitFor(() => expect(within(screen.getByTestId('tracking-phase')).getByText('Qiymət mübahisəsi admin tərəfindən araşdırılır')).toBeTruthy());
  });

  it('English payment texts', async () => {
    setup(priced());
    secureStore().set('tf.language', 'en');
    await renderRouter(APP_DIR, { initialUrl: `${BASE}/pay` });
    await waitFor(() => expect(screen.getByText('Choose how to pay')).toBeTruthy());
    expect(screen.getByText('Pay ₼45.00')).toBeTruthy();
  });
});

describe('tip and rating', () => {
  beforeEach(() => {
    resetApp();
    browser().mockReset();
    browser().mockResolvedValue({ type: 'cancel' });
  });

  it('tip: preset chips and a custom amount go through the checkout, then the rating', async () => {
    const { api, state } = setup(completed());
    api.use(
      on('POST', '/assignments/:id/tip', () => {
        state.payment = intent({ id: M3.intent2, purpose: 'TIP', amount: 700, status: 'CREATED', checkoutUrl: CHECKOUT_URL });
        return ok({ paymentIntentId: M3.intent2, checkoutUrl: CHECKOUT_URL });
      }),
    );
    browser().mockImplementation(async () => {
      state.payment = intent({ id: M3.intent2, purpose: 'TIP', amount: 700, status: 'SUCCEEDED' });
      return { type: 'success', url: `tezfiks://payment?paymentIntentId=${M3.intent2}&status=SUCCEEDED` };
    });
    const r = await renderRouter(APP_DIR, { initialUrl: `${BASE}/tip` });
    await waitFor(() => expect(screen.getByTestId('tip-amount')).toBeTruthy());
    // UX-C17 (design v2): no tip is preselected.
    expect(screen.getByText('Ustaya bəxşiş ver')).toBeTruthy();
    expect(screen.getByTestId('tip-amount-preset-500').props.accessibilityState.selected).toBe(false);
    await fireEvent.changeText(screen.getByTestId('tip-amount-custom'), '0,5');
    await fireEvent.press(screen.getByTestId('tip-send'));
    expect(screen.getByText('Minimum məbləğ 1 ₼-dir')).toBeTruthy();
    expect(api.find('POST', `/assignments/${IDS.assignment}/tip`)).toHaveLength(0);
    await fireEvent.changeText(screen.getByTestId('tip-amount-custom'), '7');
    await fireEvent.press(screen.getByTestId('tip-send'));
    await waitFor(() => expect(r.getPathname()).toBe(`${BASE}/rate`));
    expect(api.find('POST', `/assignments/${IDS.assignment}/tip`)[0].body).toEqual({ amount: 700, returnUrl: 'tezfiks://payment' });
    expect(api.find('POST', `/assignments/${IDS.assignment}/tip`)[0].headers['Idempotency-Key']).toBeTruthy();
  });

  it('tip is offered only when the server allows it (card-paid jobs); skip goes to the rating', async () => {
    setup(completed({ paymentMethod: 'CASH', actions: { ...completed().actions, tip: false } }));
    const r = await renderRouter(APP_DIR, { initialUrl: `${BASE}/tip` });
    await waitFor(() => expect(screen.getByTestId('tip-unavailable')).toBeTruthy());
    expect(screen.getByText('Bəxşiş yalnız kartla ödənilmiş işlər üçün mümkündür')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('tip-skip'));
    await waitFor(() => expect(r.getPathname()).toBe(`${BASE}/rate`));
  });

  it('rating (C2): stars required, then sent once with the comment', async () => {
    const { api, state } = setup(completed());
    api.use(
      on('POST', '/assignments/:id/rating', () => {
        state.a = completed({ rated: true, actions: { ...completed().actions, rate: false } });
        return ok({ ok: true });
      }),
    );
    const r = await renderRouter(APP_DIR, { initialUrl: `${BASE}/rate` });
    await waitFor(() => expect(screen.getByTestId('rate-form')).toBeTruthy());
    expect(screen.getByText('İş tamamlandı!')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('rate-form-subtitle').props.children).toBe('Elvin M. • Santexnik • Sifariş #1042'));
    await fireEvent.press(screen.getByTestId('rate-form-submit'));
    expect(screen.getByText('Ulduz sayını seçin')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('rate-form-stars-5'));
    await fireEvent.changeText(screen.getByTestId('rate-form-comment'), 'Çox səliqəli işlədi, təşəkkürlər!');
    await fireEvent.press(screen.getByTestId('rate-form-submit'));
    await waitFor(() => expect(r.getPathname()).toBe(BASE));
    expect(api.find('POST', `/assignments/${IDS.assignment}/rating`)[0].body).toEqual({ stars: 5, comment: 'Çox səliqəli işlədi, təşəkkürlər!' });
  });

  it('ALREADY_RATED is treated as done', async () => {
    const { api } = setup(completed());
    api.use(on('POST', '/assignments/:id/rating', () => fail(409, 'ALREADY_RATED')));
    const r = await renderRouter(APP_DIR, { initialUrl: `${BASE}/rate` });
    await waitFor(() => expect(screen.getByTestId('rate-form')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('rate-form-stars-4'));
    await fireEvent.press(screen.getByTestId('rate-form-submit'));
    await waitFor(() => expect(r.getPathname()).toBe(BASE));
  });

  it('guarantee claim: description and CASE_PHOTO uploads, then my claims', async () => {
    const { api } = setup(completed(), [
      on('POST', '/assignments/:id/guarantee-claim', () =>
        ok({
          id: M3.case,
          type: 'GUARANTEE',
          status: 'OPEN',
          assignmentId: IDS.assignment,
          projectId: null,
          requestNumber: 1042,
          projectNumber: null,
          description: 'Kran yenidən damcılayır',
          photos: [],
          resolutionNote: null,
          followUpRequestId: null,
          createdAt: '2026-10-26T10:00:00.000Z',
          updatedAt: '2026-10-26T10:00:00.000Z',
        }),
      ),
      on('GET', '/cases', () => ok({ items: [], nextCursor: null })),
    ]);
    const r = await renderRouter(APP_DIR, { initialUrl: `${BASE}/guarantee` });
    await waitFor(() => expect(screen.getByTestId('guarantee-form')).toBeTruthy());
    expect(screen.getByText('Zəmanət 08.11.2099 tarixinədək qüvvədədir')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('guarantee-form-submit'));
    expect(screen.getByText('Problemi ən azı 5 simvolla təsvir edin')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('guarantee-form-description'), 'Kran yenidən damcılayır');
    await fireEvent.press(screen.getByTestId('guarantee-form-submit'));
    await waitFor(() => expect(r.getPathname()).toBe('/cases'));
    expect(api.find('POST', `/assignments/${IDS.assignment}/guarantee-claim`)[0].body).toEqual({ description: 'Kran yenidən damcılayır', photoFileIds: [] });
  });

  it('guarantee is not offered for cash jobs', async () => {
    setup(completed({ paymentMethod: 'CASH', guaranteeUntil: null, actions: { ...completed().actions, guaranteeClaim: false } }));
    await renderRouter(APP_DIR, { initialUrl: `${BASE}/guarantee` });
    await waitFor(() => expect(screen.getByTestId('guarantee-unavailable')).toBeTruthy());
  });
});
