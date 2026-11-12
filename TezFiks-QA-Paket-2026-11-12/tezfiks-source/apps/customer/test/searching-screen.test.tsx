import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import path from 'node:path';
import { gridDisk, gridRing, latLngToCell } from 'h3-js';
import { IDS, assignment, detail } from './fixtures';
import { fail, lastSocket, ok, on, resetApp, serverEmit, signedInCustomer } from './screen-helpers';

const APP_DIR = path.join(__dirname, '..', 'src', 'app');
const center = latLngToCell(40.4093, 49.8671, 7);
const URL = `/request/${IDS.request}/searching`;

describe('searching screen (board 02 B4)', () => {
  beforeEach(() => resetApp());

  it('draws the covered H3 cells, grows with request:search events and shows the reach', async () => {
    signedInCustomer({ extra: [on('GET', '/requests/:id', () => ok(detail({ search: { ...detail().search!, cells: [center] } })))] });
    await renderRouter(APP_DIR, { initialUrl: URL });
    await waitFor(() => expect(screen.getByTestId('searching-screen')).toBeTruthy());
    expect(screen.getByText('Yaxınlıqdakı ustalar axtarılır...')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId(`hex-${center}`)).toBeTruthy());
    expect(screen.getByText('Sifarişiniz 1,2 km radiusdakı ustalara göndərildi. Orta gözləmə müddəti: 1-3 dəqiqə')).toBeTruthy();

    const ring1 = gridRing(center, 1);
    await serverEmit('request:search', {
      requestId: IDS.request,
      step: 1,
      ring: 1,
      wide: false,
      cells: [center, ...ring1],
      startedAt: '2026-10-25T10:00:00.000Z',
      endsAt: '2099-01-01T00:00:00.000Z',
      offersSent: 4,
    });
    for (const c of ring1) expect(screen.getByTestId(`hex-${c}`)).toBeTruthy();
    expect(screen.getByText('Sifarişiniz 2,9 km radiusdakı ustalara göndərildi. Orta gözləmə müddəti: 1-3 dəqiqə')).toBeTruthy();

    // Events for other requests are ignored.
    const other = gridRing(center, 3)[0];
    await serverEmit('request:search', { requestId: IDS.request2, step: 3, ring: 3, wide: false, cells: [other], startedAt: '2026-10-25T10:00:00.000Z', endsAt: '2099-01-01T00:00:00.000Z', offersSent: 1 });
    expect(screen.queryByTestId(`hex-${other}`)).toBeNull();
    expect(screen.getAllByTestId(/^hex-/)).toHaveLength(7);
  });

  it('joins the request room once the socket is connected', async () => {
    signedInCustomer({ extra: [on('GET', '/requests/:id', () => ok(detail()))] });
    await renderRouter(APP_DIR, { initialUrl: URL });
    await waitFor(() => expect(screen.getByTestId('searching-screen')).toBeTruthy());
    await serverEmit('connect', undefined);
    await waitFor(() => expect(lastSocket()!.emit).toHaveBeenCalledWith('room:join', { room: 'request', id: IDS.request }));
  });

  // Spec customer flow B4 → B5: when the handyman accepts a single-handyman request, the customer goes straight to the
  // live tracking (map, ETA, handyman card), not to the static request detail (this test asserted the detail before).
  it('moves to the live tracking of the handyman who accepts a single-handyman request (request:updated → ASSIGNED)', async () => {
    let current = detail();
    signedInCustomer({ extra: [on('GET', '/requests/:id', () => ok(current)), on('GET', '/assignments/:id', () => ok(assignment()))] });
    const r = await renderRouter(APP_DIR, { initialUrl: URL });
    await waitFor(() => expect(screen.getByTestId('searching-screen')).toBeTruthy());
    current = detail({
      status: 'ASSIGNED',
      isSearching: false,
      slotsFilled: 1,
      search: null,
      slots: [{ index: 0, status: 'FILLED', assignmentId: IDS.assignment }],
      assignments: [assignment()],
    });
    await serverEmit('request:updated', { requestId: IDS.request, status: 'ASSIGNED' });
    await waitFor(() => expect(screen.getByTestId('tracking-screen')).toBeTruthy());
    expect(r.getPathname()).toBe(`/assignment/${IDS.assignment}`);
    await waitFor(() => expect(within(screen.getByTestId('tracking-provider')).getByText('Elvin Məmmədov')).toBeTruthy());
    expect(within(screen.getByTestId('tracking-provider')).getByText(/348 sifariş/)).toBeTruthy();
  });

  it('a request cancelled elsewhere while searching still moves to the request detail', async () => {
    let current = detail();
    signedInCustomer({ extra: [on('GET', '/requests/:id', () => ok(current))] });
    const r = await renderRouter(APP_DIR, { initialUrl: URL });
    await waitFor(() => expect(screen.getByTestId('searching-screen')).toBeTruthy());
    current = detail({ status: 'CANCELLED', isSearching: false, search: null, canCancel: false, cancelledAt: '2026-10-25T10:02:00.000Z', slots: [{ index: 0, status: 'CANCELLED', assignmentId: null }] });
    await serverEmit('request:updated', { requestId: IDS.request, status: 'CANCELLED' });
    await waitFor(() => expect(screen.getByTestId('request-detail-screen')).toBeTruthy());
    expect(r.getPathname()).toBe(`/request/${IDS.request}`);
  });

  it('a refused cancel shows its error above the open cancel sheet (the modal covers the root toast host)', async () => {
    signedInCustomer({ extra: [on('GET', '/requests/:id', () => ok(detail())), on('POST', '/requests/:id/cancel', () => fail(409, 'INVALID_STATE'))] });
    await renderRouter(APP_DIR, { initialUrl: URL });
    await waitFor(() => expect(screen.getByTestId('searching-cancel')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('searching-cancel'));
    await fireEvent.press(screen.getByTestId('searching-cancel-confirm'));
    await waitFor(() => expect(within(screen.getByTestId('searching-cancel-sheet')).getByText('Bu əməliyyat indiki mərhələdə mümkün deyil')).toBeTruthy());
    expect(screen.getAllByTestId('toast')).toHaveLength(1);
  });

  it('cancel: free inside the search, confirms and shows the cancelled request', async () => {
    let current = detail({ timing: 'EMERGENCY', emergencyFee: { perSlot: 500, total: 500, captured: 0 } });
    const api = signedInCustomer({
      extra: [
        on('GET', '/requests/:id', () => ok(current)),
        on('POST', '/requests/:id/cancel', () => {
          current = detail({ status: 'CANCELLED', isSearching: false, search: null, canCancel: false, cancelledAt: '2026-10-25T10:02:00.000Z', slots: [{ index: 0, status: 'CANCELLED', assignmentId: null }] });
          return ok(current);
        }),
      ],
    });
    const r = await renderRouter(APP_DIR, { initialUrl: URL });
    await waitFor(() => expect(screen.getByTestId('searching-cancel')).toBeTruthy());
    expect(screen.getByText('Təcili sifariş haqqı (5,00 ₼) balansınızda bloklanıb')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('searching-cancel'));
    expect(screen.getByText('Ləğv pulsuzdur. Bloklanmış təcili haqq balansınıza qaytarılacaq.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('searching-cancel-confirm'));
    await waitFor(() => expect(screen.getByTestId('request-detail-screen')).toBeTruthy());
    expect(r.getPathname()).toBe(`/request/${IDS.request}`);
    expect(api.find('POST', `/requests/${IDS.request}/cancel`)).toHaveLength(1);
    expect(api.find('POST', `/requests/${IDS.request}/cancel`)[0].headers['Idempotency-Key']).toBeTruthy();
    expect(within(screen.getByTestId('detail-status')).getByText('Ləğv edildi')).toBeTruthy();
    expect(screen.queryByTestId('detail-cancel')).toBeNull();
  });

  it('a cancel the server refuses shows the localized error', async () => {
    signedInCustomer({ extra: [on('GET', '/requests/:id', () => ok(detail({ cancelPenaltyPreview: 1500 }))), on('POST', '/requests/:id/cancel', () => fail(409, 'INVALID_STATE'))] });
    await renderRouter(APP_DIR, { initialUrl: URL });
    await waitFor(() => expect(screen.getByTestId('searching-cancel')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('searching-cancel'));
    expect(screen.getByText('Ləğv etsəniz balansınızdan 15,00 ₼ cərimə tutulacaq.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('searching-cancel-confirm'));
    await waitFor(() => expect(screen.getByText('Bu əməliyyat indiki mərhələdə mümkün deyil')).toBeTruthy());
  });

  it('an expired search offers to order again with the same details', async () => {
    signedInCustomer({ extra: [on('GET', '/requests/:id', () => ok(detail({ status: 'EXPIRED', isSearching: false, search: null, canCancel: false })))] });
    const r = await renderRouter(APP_DIR, { initialUrl: URL });
    await waitFor(() => expect(screen.getByTestId('searching-expired')).toBeTruthy());
    expect(screen.getByText('Usta tapılmadı')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('searching-repeat'));
    await waitFor(() => expect(screen.getByTestId('create-request-screen')).toBeTruthy());
    expect(r.getSearchParams()).toMatchObject({ repeatId: IDS.request });
    await waitFor(() => expect(screen.getByTestId('request-description').props.value).toBe('Mətbəxdə kran damcılayır, sifon da yoxlanmalıdır'));
    expect(screen.getByTestId('request-address-text').props.children).toBe('Atatürk pr. 45, Nərimanov');
  });

  it('emergency step 0 cells (k≤1 disk) all render', async () => {
    signedInCustomer({ extra: [on('GET', '/requests/:id', () => ok(detail({ timing: 'EMERGENCY', search: { ...detail().search!, cells: gridDisk(center, 1) } })))] });
    await renderRouter(APP_DIR, { initialUrl: URL });
    await waitFor(() => expect(screen.getAllByTestId(/^hex-/)).toHaveLength(7));
  });
});
