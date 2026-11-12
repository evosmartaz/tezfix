import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import path from 'node:path';
import { gridRing, latLngToCell } from 'h3-js';
import { IDS, assignment, detail } from './fixtures';
import { secureStore } from './helpers';
import { flush, ok, on, resetApp, serverEmit, signedInCustomer } from './screen-helpers';

/*
 * Spec 6.1: a request becomes ASSIGNED as soon as one slot is filled, and isSearching stays true while its open slots
 * are still being dispatched. The live search must stay usable in that state (multi-handyman requests).
 */

const APP_DIR = path.join(__dirname, '..', 'src', 'app');
const center = latLngToCell(40.4093, 49.8671, 7);
const SEARCH_URL = `/request/${IDS.request}/searching`;
const DETAIL_URL = `/request/${IDS.request}`;

const twoSlotsSearching = () =>
  detail({
    slotsRequested: 2,
    slots: [
      { index: 0, status: 'OPEN', assignmentId: null },
      { index: 1, status: 'OPEN', assignmentId: null },
    ],
    search: { ...detail().search!, cells: [center] },
  });

const oneOfTwoFound = (over: Parameters<typeof detail>[0] = {}) =>
  detail({
    status: 'ASSIGNED',
    isSearching: true,
    slotsRequested: 2,
    slotsFilled: 1,
    slots: [
      { index: 0, status: 'FILLED', assignmentId: IDS.assignment },
      { index: 1, status: 'OPEN', assignmentId: null },
    ],
    assignments: [assignment()],
    search: { ...detail().search!, cells: [center] },
    ...over,
  });

describe('multi-handyman request partly filled while the search continues', () => {
  beforeEach(() => resetApp());

  it('stays on the live search when the first of two handymen accepts, lists him and counts 1 / 2', async () => {
    let current = twoSlotsSearching();
    signedInCustomer({ extra: [on('GET', '/requests/:id', () => ok(current))] });
    const r = await renderRouter(APP_DIR, { initialUrl: SEARCH_URL });
    await waitFor(() => expect(screen.getByTestId('searching-screen')).toBeTruthy());
    expect(screen.getByTestId('searching-slots').props.children).toBe('0 / 2 usta tapıldı');
    expect(screen.queryByTestId('searching-found')).toBeNull();
    expect(screen.queryByTestId('searching-view-order')).toBeNull();

    current = oneOfTwoFound();
    await serverEmit('request:updated', { requestId: IDS.request, status: 'ASSIGNED' });
    await waitFor(() => expect(screen.getByTestId('searching-slots').props.children).toBe('1 / 2 usta tapıldı'));
    await flush(50);
    // Still the live search, not the detail.
    expect(r.getPathname()).toBe(SEARCH_URL);
    expect(screen.getByTestId('searching-screen')).toBeTruthy();
    expect(screen.queryByTestId('request-detail-screen')).toBeNull();
    expect(screen.getByText('Qalan ustalar axtarılır...')).toBeTruthy();
    expect(within(screen.getByTestId(`searching-found-${IDS.assignment}`)).getByText('Elvin Məmmədov')).toBeTruthy();
    expect(within(screen.getByTestId(`searching-found-${IDS.assignment}`)).getByText(/348 sifariş/)).toBeTruthy();
    // The hexagons keep growing for the open slot.
    const ring1 = gridRing(center, 1);
    await serverEmit('request:search', { requestId: IDS.request, step: 1, ring: 1, wide: false, cells: [center, ...ring1], startedAt: '2026-10-25T10:00:00.000Z', endsAt: '2099-01-01T00:00:00.000Z', offersSent: 6 });
    expect(screen.getAllByTestId(/^hex-/)).toHaveLength(7);
    expect(screen.getByTestId('searching-countdown')).toBeTruthy();
  });

  it('the detail "searching now" card opens a live search that stays open (no bounce back to the detail)', async () => {
    signedInCustomer({ extra: [on('GET', '/requests/:id', () => ok(oneOfTwoFound()))] });
    const r = await renderRouter(APP_DIR, { initialUrl: DETAIL_URL });
    await waitFor(() => expect(screen.getByTestId('detail-searching')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('detail-searching'));
    await waitFor(() => expect(screen.getByTestId('searching-screen')).toBeTruthy());
    await flush(50);
    expect(r.getPathname()).toBe(SEARCH_URL);
    expect(screen.getByTestId('searching-screen')).toBeTruthy();
    expect(screen.getByTestId('searching-slots').props.children).toBe('1 / 2 usta tapıldı');

    // "Sifarişə bax" goes back to the order.
    await fireEvent.press(screen.getByTestId('searching-view-order'));
    await waitFor(() => expect(r.getPathname()).toBe(DETAIL_URL));
    expect(screen.getByTestId('request-detail-screen')).toBeTruthy();
  });

  it('moves to the detail once the search for the remaining handymen is over', async () => {
    let current = oneOfTwoFound();
    signedInCustomer({ extra: [on('GET', '/requests/:id', () => ok(current))] });
    const r = await renderRouter(APP_DIR, { initialUrl: SEARCH_URL });
    await waitFor(() => expect(screen.getByTestId('searching-found')).toBeTruthy());
    // The second handyman accepts: all slots filled, the search stops.
    current = oneOfTwoFound({
      isSearching: false,
      slotsFilled: 2,
      search: null,
      slots: [
        { index: 0, status: 'FILLED', assignmentId: IDS.assignment },
        { index: 1, status: 'FILLED', assignmentId: '50000000-0000-4000-a000-000000000002' },
      ],
      assignments: [assignment(), assignment({ id: '50000000-0000-4000-a000-000000000002', slotIndex: 1, provider: { ...assignment().provider, firstName: 'Rəşad', lastName: 'Quliyev' } })],
    });
    await serverEmit('assignment:updated', { assignmentId: '50000000-0000-4000-a000-000000000002', requestId: IDS.request, status: 'ACCEPTED' });
    await waitFor(() => expect(screen.getByTestId('request-detail-screen')).toBeTruthy());
    expect(r.getPathname()).toBe(DETAIL_URL);
    expect(screen.getByText('Ustalar (2 / 2)')).toBeTruthy();
    expect(screen.queryByTestId('detail-searching')).toBeNull();
  });

  it('assignment events of other requests do not refetch this one', async () => {
    const api = signedInCustomer({ extra: [on('GET', '/requests/:id', () => ok(oneOfTwoFound()))] });
    await renderRouter(APP_DIR, { initialUrl: SEARCH_URL });
    await waitFor(() => expect(screen.getByTestId('searching-found')).toBeTruthy());
    await flush(10);
    const before = api.find('GET', `/requests/${IDS.request}`).length;
    await serverEmit('assignment:updated', { assignmentId: IDS.assignment, requestId: IDS.request2, status: 'EN_ROUTE' });
    await flush(10);
    expect(api.find('GET', `/requests/${IDS.request}`)).toHaveLength(before);
  });

  it('cancelling a partly filled request shows the penalty for the handyman already assigned', async () => {
    signedInCustomer({ extra: [on('GET', '/requests/:id', () => ok(oneOfTwoFound({ cancelPenaltyPreview: 1500 })))] });
    await renderRouter(APP_DIR, { initialUrl: SEARCH_URL });
    await waitFor(() => expect(screen.getByTestId('searching-cancel')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('searching-cancel'));
    expect(screen.getByText('Ləğv etsəniz balansınızdan 15,00 ₼ cərimə tutulacaq.')).toBeTruthy();
  });

  it('a scheduled request with a handyman but no live ring dispatch yet shows no live-search link', async () => {
    signedInCustomer({ extra: [on('GET', '/requests/:id', () => ok(oneOfTwoFound({ timing: 'SCHEDULED', scheduledAt: '2026-10-26T08:30:00.000Z', search: null })))] });
    await renderRouter(APP_DIR, { initialUrl: DETAIL_URL });
    await waitFor(() => expect(screen.getByTestId('request-detail-screen')).toBeTruthy());
    expect(screen.queryByTestId('detail-searching')).toBeNull();
  });

  it('English and Russian: partly filled search texts', async () => {
    signedInCustomer({ extra: [on('GET', '/requests/:id', () => ok(oneOfTwoFound()))] });
    secureStore().set('tf.language', 'en');
    await renderRouter(APP_DIR, { initialUrl: SEARCH_URL });
    await waitFor(() => expect(screen.getByText('Looking for the remaining handymen...')).toBeTruthy());
    expect(screen.getByText('1 of 2 handymen found')).toBeTruthy();
    expect(screen.getByText('Handymen found')).toBeTruthy();
    expect(screen.getByText('View order')).toBeTruthy();
  });

  it('Russian: partly filled search texts', async () => {
    signedInCustomer({ extra: [on('GET', '/requests/:id', () => ok(oneOfTwoFound()))] });
    secureStore().set('tf.language', 'ru');
    await renderRouter(APP_DIR, { initialUrl: SEARCH_URL });
    await waitFor(() => expect(screen.getByText('Ищем остальных мастеров...')).toBeTruthy());
    expect(screen.getByText('Найдено мастеров: 1 из 2')).toBeTruthy();
    expect(screen.getByText('Открыть заказ')).toBeTruthy();
  });
});
