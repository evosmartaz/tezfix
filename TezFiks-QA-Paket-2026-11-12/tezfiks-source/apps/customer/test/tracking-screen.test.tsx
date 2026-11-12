import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import path from 'node:path';
import { Linking } from 'react-native';
import { IDS, assignment, detail } from './fixtures';
import { M3, completed, enRoute, priced } from './fixtures-m3';
import { secureStore } from './helpers';
import { fail, flush, lastSocket, ok, on, resetApp, serverEmit, signedInCustomer, type Handler } from './screen-helpers';

const APP_DIR = path.join(__dirname, '..', 'src', 'app');
const URL = `/assignment/${IDS.assignment}`;

const requestWith = (...assignments: ReturnType<typeof assignment>[]) =>
  detail({
    status: 'IN_PROGRESS',
    isSearching: false,
    search: null,
    slotsRequested: assignments.length,
    slotsFilled: assignments.length,
    slots: assignments.map((a, i) => ({ index: i, status: 'FILLED' as const, assignmentId: a.id })),
    assignments,
  });

function setup(initial: ReturnType<typeof assignment>, extra: Handler[] = []) {
  const state = { a: initial };
  const api = signedInCustomer({
    extra: [
      ...extra,
      on('GET', '/assignments/:id', (_c, p) => (p.id === state.a.id ? ok(state.a) : fail(404, 'NOT_FOUND'))),
      on('GET', '/requests/:id', () => ok(requestWith(state.a))),
    ],
  });
  return { api, state };
}

describe('tracking (board 02 B5)', () => {
  beforeEach(() => resetApp());

  it('shows the route, the live position and "12 dəq məsafədə"; a location ping moves the marker and lowers the ETA', async () => {
    setup(enRoute());
    await renderRouter(APP_DIR, { initialUrl: URL });
    await waitFor(() => expect(screen.getByTestId('tracking-screen')).toBeTruthy());
    expect(screen.getByTestId('tracking-map')).toBeTruthy();
    expect(within(screen.getByTestId('tracking-eta')).getByText('12 dəq məsafədə')).toBeTruthy();
    expect(screen.getByText('Usta yola çıxıb — sifarişiniz qəbul edildi')).toBeTruthy();
    expect(screen.getByTestId('Polyline')).toBeTruthy();
    await waitFor(() => expect(screen.getAllByTestId('Marker')).toHaveLength(2));
    expect(within(screen.getByTestId('tracking-provider')).getByText('Elvin Məmmədov')).toBeTruthy();

    await serverEmit('assignment:location', { assignmentId: IDS.assignment, lat: 40.415, lng: 49.872, heading: 210, at: new Date(Date.now() + 1000).toISOString(), etaSec: 250, distanceM: 900 });
    await waitFor(() => expect(within(screen.getByTestId('tracking-eta')).getByText('5 dəq məsafədə')).toBeTruthy());
    // Pings for other assignments are ignored.
    await serverEmit('assignment:location', { assignmentId: M3.assignment2, lat: 40.5, lng: 49.9, heading: null, at: new Date(Date.now() + 2000).toISOString(), etaSec: 30, distanceM: 10 });
    await flush(50);
    expect(within(screen.getByTestId('tracking-eta')).getByText('5 dəq məsafədə')).toBeTruthy();
  });

  it('call and chat are locked with the explanation until the contact unlock; no phone anywhere', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const { state } = setup(enRoute());
    await renderRouter(APP_DIR, { initialUrl: URL });
    await waitFor(() => expect(screen.getByTestId('tracking-call')).toBeTruthy());
    expect(screen.getByText('Zəng bağlıdır')).toBeTruthy();
    expect(screen.getByTestId('tracking-call')).toBeDisabled();
    expect(screen.getByTestId('tracking-chat')).toBeDisabled();
    expect(screen.getByTestId('tracking-locked-hint')).toBeTruthy();
    expect(screen.queryByTestId('tracking-phone')).toBeNull();
    expect(screen.queryByText(/\+994/)).toBeNull();
    await fireEvent.press(screen.getByTestId('tracking-call'));
    expect(openURL).not.toHaveBeenCalled();

    // The server unlocks the contact (ETA <= 5 min): assignment:contact → refetch.
    state.a = enRoute({ etaSec: 280, contactUnlocked: true, providerPhone: '+994501112233', chatEnabled: true });
    await serverEmit('assignment:contact', { assignmentId: IDS.assignment });
    await waitFor(() => expect(screen.getByTestId('tracking-phone')).toBeTruthy());
    expect(screen.getByText('Telefon: +994 50 111 22 33')).toBeTruthy();
    expect(screen.queryByTestId('tracking-locked-hint')).toBeNull();
    expect(screen.getByTestId('tracking-call')).not.toBeDisabled();
    await fireEvent.press(screen.getByTestId('tracking-call'));
    expect(openURL).toHaveBeenCalledWith('tel:+994501112233');
    openURL.mockRestore();
  });

  it('joins the assignment room once connected', async () => {
    setup(enRoute());
    await renderRouter(APP_DIR, { initialUrl: URL });
    await waitFor(() => expect(screen.getByTestId('tracking-screen')).toBeTruthy());
    await serverEmit('connect', undefined);
    await flush(10);
    expect(lastSocket()?.emit).toHaveBeenCalledWith('room:join', { room: 'assignment', id: IDS.assignment });
  });

  it('cancel after the free window shows the 15 AZN penalty and sends one idempotent call with the reason', async () => {
    const { api, state } = setup(enRoute());
    api.use(
      on('POST', '/assignments/:id/cancel', () => {
        state.a = enRoute({ status: 'CANCELLED_BY_CUSTOMER', cancelledAt: new Date().toISOString(), cancelledBy: 'CUSTOMER', actions: { ...enRoute().actions, cancel: false } });
        return ok(state.a);
      }),
    );
    await renderRouter(APP_DIR, { initialUrl: URL });
    await waitFor(() => expect(screen.getByTestId('tracking-cancel')).toBeTruthy());
    expect(screen.queryByTestId('tracking-free-cancel')).toBeNull();
    await fireEvent.press(screen.getByTestId('tracking-cancel'));
    expect(screen.getByText('Pulsuz ləğv müddəti bitib. Ləğv etsəniz balansınızdan 15,00 ₼ cərimə tutulacaq.')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('tracking-cancel-sheet-reason'), 'Planlarım dəyişdi');
    await fireEvent.press(screen.getByTestId('tracking-cancel-sheet-confirm'));
    await waitFor(() => expect(api.find('POST', `/assignments/${IDS.assignment}/cancel`)).toHaveLength(1));
    const call = api.find('POST', `/assignments/${IDS.assignment}/cancel`)[0];
    expect(call.body).toEqual({ reason: 'Planlarım dəyişdi' });
    expect(call.headers['Idempotency-Key']).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Usta ləğv edildi')).toBeTruthy());
    expect(screen.queryByTestId('tracking-cancel')).toBeNull();
  });

  it('inside the free window the countdown runs and cancelling is free', async () => {
    const until = new Date(Date.now() + 120_000).toISOString();
    setup(assignment({ freeCancelUntil: until, acceptedAt: new Date(Date.now() - 180_000).toISOString() }));
    await renderRouter(APP_DIR, { initialUrl: URL });
    await waitFor(() => expect(screen.getByTestId('tracking-free-cancel')).toBeTruthy());
    expect(screen.getByText('Pulsuz ləğv üçün qalan vaxt')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('tracking-cancel'));
    expect(screen.getByTestId('tracking-cancel-sheet-message').props.children).toBe('Ləğv pulsuzdur.');
  });

  it('a failed cancel shows the localized error and keeps the screen', async () => {
    const { api } = setup(enRoute());
    api.use(on('POST', '/assignments/:id/cancel', () => fail(409, 'CANCEL_NOT_ALLOWED')));
    await renderRouter(APP_DIR, { initialUrl: URL });
    await waitFor(() => expect(screen.getByTestId('tracking-cancel')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('tracking-cancel'));
    await fireEvent.press(screen.getByTestId('tracking-cancel-sheet-confirm'));
    await waitFor(() => expect(api.find('POST', `/assignments/${IDS.assignment}/cancel`)).toHaveLength(1));
    expect(screen.getByTestId('tracking-screen')).toBeTruthy();
  });

  it('reports a no-show when the server allows it', async () => {
    const { api, state } = setup(enRoute({ actions: { ...enRoute().actions, reportNoShow: true } }));
    api.use(
      on('POST', '/assignments/:id/report-no-show', () => {
        state.a = enRoute({ status: 'NO_SHOW', actions: { ...enRoute().actions, cancel: false, reportNoShow: false } });
        return ok(state.a);
      }),
    );
    await renderRouter(APP_DIR, { initialUrl: URL });
    await waitFor(() => expect(screen.getByTestId('tracking-noshow')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('tracking-noshow'));
    await fireEvent.press(screen.getByTestId('tracking-noshow-sheet-confirm'));
    await waitFor(() => expect(api.find('POST', `/assignments/${IDS.assignment}/report-no-show`)).toHaveLength(1));
    expect(api.find('POST', `/assignments/${IDS.assignment}/report-no-show`)[0].headers['Idempotency-Key']).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Bildirişiniz qəbul edildi, yeni usta axtarılır')).toBeTruthy());
  });

  it('arrived: decline on arrival warns with the declinePenalty from the server', async () => {
    const arrived = assignment({
      status: 'ARRIVED',
      arrivedAt: new Date().toISOString(),
      contactUnlocked: true,
      providerPhone: '+994501112233',
      chatEnabled: true,
      actions: { ...assignment().actions, cancel: false, declineOnArrival: true, declinePenalty: 1500 },
    });
    const { api } = setup(arrived);
    api.use(on('POST', '/assignments/:id/decline-on-arrival', () => ok({ ...arrived, status: 'DECLINED_ON_ARRIVAL', actions: { ...arrived.actions, declineOnArrival: false } })));
    await renderRouter(APP_DIR, { initialUrl: URL });
    await waitFor(() => expect(within(screen.getByTestId('tracking-phase')).getByText('Usta ünvana çatdı')).toBeTruthy());
    expect(screen.queryByTestId('tracking-cancel')).toBeNull();
    await fireEvent.press(screen.getByTestId('tracking-decline'));
    // Copy change (same behaviour): the warning now states the split (spec: 10 AZN to the handyman, 5 AZN to the platform)
    // and that a short balance becomes a debt.
    expect(
      screen.getByText(
        'Usta artıq ünvandadır. İmtina etsəniz 15,00 ₼ tutulacaq: 10,00 ₼ ustaya yol kompensasiyası, 5,00 ₼ platformaya. Balans çatmasa borc yaranacaq və yeni sifarişdən əvvəl ödənilməlidir.',
      ),
    ).toBeTruthy();
    await fireEvent.press(screen.getByTestId('tracking-decline-sheet-confirm'));
    await waitFor(() => expect(api.find('POST', `/assignments/${IDS.assignment}/decline-on-arrival`)).toHaveLength(1));
  });

  const arrivedWith = (declinePenalty: number) =>
    assignment({
      status: 'ARRIVED',
      arrivedAt: new Date().toISOString(),
      contactUnlocked: true,
      providerPhone: '+994501112233',
      chatEnabled: true,
      actions: { ...assignment().actions, cancel: false, declineOnArrival: true, declinePenalty },
    });

  it('decline on arrival in English states the split and the debt rule; the sheet closes with "Go back"', async () => {
    setup(arrivedWith(1500));
    secureStore().set('tf.language', 'en');
    await renderRouter(APP_DIR, { initialUrl: URL });
    await waitFor(() => expect(screen.getByTestId('tracking-decline')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('tracking-decline'));
    expect(
      screen.getByText(
        'The handyman is already here. If you decline, ₼15.00 is charged: ₼10.00 goes to the handyman for the trip, ₼5.00 to the platform. If your balance is short, it becomes a debt to settle before your next order.',
      ),
    ).toBeTruthy();
    expect(within(screen.getByTestId('tracking-decline-sheet-keep')).getByText('Go back')).toBeTruthy();
  });

  it('decline on arrival never shows a platform share above the charge the server reports', async () => {
    setup(arrivedWith(800));
    await renderRouter(APP_DIR, { initialUrl: URL });
    await waitFor(() => expect(screen.getByTestId('tracking-decline')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('tracking-decline'));
    expect(screen.getByTestId('tracking-decline-sheet-message').props.children).toMatch(/İmtina etsəniz 8,00\s₼ tutulacaq: 8,00\s₼ ustaya yol kompensasiyası, 0,00\s₼ platformaya\./);
  });

  it('a refused decline on arrival shows its error above the open sheet (the modal covers the root toast host)', async () => {
    const { api } = setup(arrivedWith(1500));
    api.use(on('POST', '/assignments/:id/decline-on-arrival', () => fail(409, 'INVALID_STATE')));
    await renderRouter(APP_DIR, { initialUrl: URL });
    await waitFor(() => expect(screen.getByTestId('tracking-decline')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('tracking-decline'));
    await fireEvent.press(screen.getByTestId('tracking-decline-sheet-confirm'));
    await waitFor(() => expect(within(screen.getByTestId('tracking-decline-sheet')).getByText('Bu əməliyyat indiki mərhələdə mümkün deyil')).toBeTruthy());
    expect(screen.getAllByTestId('toast')).toHaveLength(1);
  });

  it('a refused cancel and a refused no-show also show their errors above the sheet', async () => {
    const { api } = setup(enRoute({ actions: { ...enRoute().actions, reportNoShow: true } }));
    api.use(
      on('POST', '/assignments/:id/cancel', () => fail(409, 'CANCEL_NOT_ALLOWED')),
      on('POST', '/assignments/:id/report-no-show', () => fail(409, 'INVALID_STATE')),
    );
    await renderRouter(APP_DIR, { initialUrl: URL });
    await waitFor(() => expect(screen.getByTestId('tracking-cancel')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('tracking-cancel'));
    await fireEvent.press(screen.getByTestId('tracking-cancel-sheet-confirm'));
    await waitFor(() => expect(within(screen.getByTestId('tracking-cancel-sheet')).getByText('Bu mərhələdə ləğv etmək mümkün deyil')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('tracking-cancel-sheet-keep'));
    await fireEvent.press(screen.getByTestId('tracking-noshow'));
    await fireEvent.press(screen.getByTestId('tracking-noshow-sheet-confirm'));
    await waitFor(() => expect(within(screen.getByTestId('tracking-noshow-sheet')).getByText('Bu əməliyyat indiki mərhələdə mümkün deyil')).toBeTruthy());
  });

  it('the money sheets close with a neutral "Geri qayıt" (not a double negative next to "İmtina et"), without calling the API', async () => {
    const { api } = setup(arrivedWith(1500));
    await renderRouter(APP_DIR, { initialUrl: URL });
    await waitFor(() => expect(screen.getByTestId('tracking-decline')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('tracking-decline'));
    expect(within(screen.getByTestId('tracking-decline-sheet-keep')).getByText('Geri qayıt')).toBeTruthy();
    expect(screen.queryByText('İmtina etmə')).toBeNull();
    await fireEvent.press(screen.getByTestId('tracking-decline-sheet-keep'));
    await waitFor(() => expect(screen.queryByTestId('tracking-decline-sheet')).toBeNull());
    expect(api.find('POST', `/assignments/${IDS.assignment}/decline-on-arrival`)).toHaveLength(0);
  });

  it('the dismiss label in Russian and English', async () => {
    setup(enRoute());
    secureStore().set('tf.language', 'ru');
    await renderRouter(APP_DIR, { initialUrl: URL });
    await waitFor(() => expect(screen.getByTestId('tracking-cancel')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('tracking-cancel'));
    expect(within(screen.getByTestId('tracking-cancel-sheet-keep')).getByText('Вернуться')).toBeTruthy();
    expect(screen.queryByText('Не отменять')).toBeNull();
  });

  it('opens the payment screen when the handyman proposes the price', async () => {
    const { state } = setup(
      assignment({ status: 'ARRIVED', arrivedAt: new Date().toISOString(), contactUnlocked: true, providerPhone: '+994501112233', chatEnabled: true }),
    );
    const r = await renderRouter(APP_DIR, { initialUrl: URL });
    await waitFor(() => expect(screen.getByTestId('tracking-screen')).toBeTruthy());
    state.a = priced();
    await serverEmit('assignment:updated', { assignmentId: IDS.assignment, requestId: IDS.request, status: 'PRICE_PROPOSED' });
    await waitFor(() => expect(r.getPathname()).toBe(`${URL}/pay`));
    expect(screen.getByTestId('pay-screen')).toBeTruthy();
  });

  it('completed card job: total, guarantee date, tip, rating and guarantee claim', async () => {
    setup(completed({ tipAmount: 500 }));
    const r = await renderRouter(APP_DIR, { initialUrl: URL });
    await waitFor(() => expect(screen.getByTestId('tracking-completed')).toBeTruthy());
    expect(screen.getByText('Yekun: 45,00 ₼')).toBeTruthy();
    expect(screen.getByText('Kartla ödənildi')).toBeTruthy();
    expect(screen.getByText('Bəxşiş: 5,00 ₼')).toBeTruthy();
    expect(screen.getByText('TezFiks Zəmanəti: 08.11.2099 tarixinədək')).toBeTruthy();
    expect(screen.queryByTestId('tracking-map')).toBeNull();
    expect(screen.getByTestId('tracking-tip')).toBeTruthy();
    expect(screen.getByTestId('tracking-guarantee')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('tracking-rate'));
    await waitFor(() => expect(r.getPathname()).toBe(`${URL}/rate`));
  });

  it('multi-handyman request: switch between the assignments', async () => {
    const second = enRoute({ id: M3.assignment2, slotIndex: 1, provider: { ...assignment().provider, handymanId: M3.handyman2, firstName: 'Rəşad', lastName: 'Quliyev' } });
    const first = enRoute();
    signedInCustomer({
      extra: [
        on('GET', '/assignments/:id', (_c, p) => ok(p.id === M3.assignment2 ? second : first)),
        on('GET', '/requests/:id', () => ok(requestWith(first, second))),
      ],
    });
    const r = await renderRouter(APP_DIR, { initialUrl: URL });
    await waitFor(() => expect(screen.getByTestId(`tracking-sibling-${M3.assignment2}`)).toBeTruthy());
    expect(within(screen.getByTestId(`tracking-sibling-${M3.assignment2}`)).getByText('Rəşad Quliyev')).toBeTruthy();
    await fireEvent.press(screen.getByTestId(`tracking-sibling-${M3.assignment2}`));
    await waitFor(() => expect(r.getPathname()).toBe(`/assignment/${M3.assignment2}`));
    await waitFor(() => expect(within(screen.getByTestId('tracking-provider')).getByText('Rəşad Quliyev')).toBeTruthy());
  });

  it('English texts', async () => {
    setup(enRoute());
    secureStore().set('tf.language', 'en');
    await renderRouter(APP_DIR, { initialUrl: URL });
    await waitFor(() => expect(screen.getByText('12 min away')).toBeTruthy());
    expect(screen.getByText('Call locked')).toBeTruthy();
    expect(screen.getByText('Order tracking')).toBeTruthy();
  });
});

describe('links into tracking', () => {
  beforeEach(() => resetApp());

  it('request detail: a handyman row opens his tracking', async () => {
    const a = enRoute();
    signedInCustomer({ extra: [on('GET', '/requests/:id', () => ok(requestWith(a))), on('GET', '/assignments/:id', () => ok(a))] });
    const r = await renderRouter(APP_DIR, { initialUrl: `/request/${IDS.request}` });
    await waitFor(() => expect(screen.getByTestId(`detail-assignment-${IDS.assignment}`)).toBeTruthy());
    await fireEvent.press(screen.getByTestId(`detail-assignment-${IDS.assignment}`));
    await waitFor(() => expect(r.getPathname()).toBe(URL));
    await waitFor(() => expect(screen.getByTestId('tracking-screen')).toBeTruthy());
  });

  it('searching screen: a found handyman opens his tracking', async () => {
    const a = assignment();
    const partly = detail({
      status: 'ASSIGNED',
      isSearching: true,
      slotsRequested: 2,
      slotsFilled: 1,
      slots: [
        { index: 0, status: 'FILLED', assignmentId: IDS.assignment },
        { index: 1, status: 'OPEN', assignmentId: null },
      ],
      assignments: [a],
    });
    signedInCustomer({ extra: [on('GET', '/requests/:id', () => ok(partly)), on('GET', '/assignments/:id', () => ok(a))] });
    const r = await renderRouter(APP_DIR, { initialUrl: `/request/${IDS.request}/searching` });
    await waitFor(() => expect(screen.getByTestId(`searching-found-${IDS.assignment}`)).toBeTruthy());
    await fireEvent.press(screen.getByTestId(`searching-found-${IDS.assignment}`));
    await waitFor(() => expect(r.getPathname()).toBe(URL));
  });
});
