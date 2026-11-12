import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import path from 'node:path';
import { IDS, assignment, detail, summary } from './fixtures';
import { ok, on, resetApp, signedInCustomer } from './screen-helpers';

const APP_DIR = path.join(__dirname, '..', 'src', 'app');
const A2 = '50000000-0000-4000-a000-000000000002';

describe('orders tab and request detail', () => {
  beforeEach(() => resetApp());

  it('lists active and history requests with status, slots and pagination', async () => {
    const api = signedInCustomer({
      extra: [
        on('GET', '/requests', (c) => {
          if (c.query.scope === 'history') {
            return c.query.cursor === 'c2'
              ? ok({ items: [summary({ id: 'h3', number: 990, status: 'EXPIRED', isSearching: false })], nextCursor: null })
              : ok({ items: [summary({ id: 'h1', number: 1001, status: 'COMPLETED', isSearching: false }), summary({ id: 'h2', number: 1000, status: 'CANCELLED', isSearching: false })], nextCursor: 'c2' });
          }
          return ok({ items: [summary({ slotsRequested: 3, slotsFilled: 1, status: 'ASSIGNED' })], nextCursor: null });
        }),
      ],
    });
    await renderRouter(APP_DIR, { initialUrl: '/orders' });
    await waitFor(() => expect(screen.getByTestId(`request-card-${IDS.request}`)).toBeTruthy());
    expect(within(screen.getByTestId(`request-status-${IDS.request}`)).getByText('Usta təyin edildi')).toBeTruthy();
    expect(screen.getByText('1 / 3 usta tapıldı')).toBeTruthy();
    expect(api.find('GET', '/requests').some((c) => c.query.scope === 'active' && c.query.limit === '20')).toBe(true);

    await fireEvent.press(screen.getByTestId('orders-scope-history'));
    await waitFor(() => expect(screen.getByTestId('request-card-h1')).toBeTruthy());
    expect(screen.getByTestId('request-card-h2')).toBeTruthy();
    await fireEvent(screen.getByTestId('orders-list'), 'endReached');
    await waitFor(() => expect(screen.getByTestId('request-card-h3')).toBeTruthy());
    expect(api.find('GET', '/requests').some((c) => c.query.scope === 'history' && c.query.cursor === 'c2')).toBe(true);
    expect(within(screen.getByTestId('request-status-h3')).getByText('Usta tapılmadı')).toBeTruthy();
  });

  it('empty lists invite to order', async () => {
    signedInCustomer();
    const r = await renderRouter(APP_DIR, { initialUrl: '/orders' });
    await waitFor(() => expect(screen.getByTestId('orders-empty')).toBeTruthy());
    expect(screen.getByText('Aktiv sifarişiniz yoxdur')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('orders-new'));
    await waitFor(() => expect(r.getPathname()).toBe('/'));
  });

  it('request detail shows slots with providers (no phone), address details and cancels with the penalty preview', async () => {
    let current = detail({
      status: 'ASSIGNED',
      isSearching: true,
      slotsRequested: 2,
      slotsFilled: 1,
      slots: [
        { index: 0, status: 'FILLED', assignmentId: IDS.assignment },
        { index: 1, status: 'OPEN', assignmentId: null },
      ],
      assignments: [assignment(), assignment({ id: A2, status: 'CANCELLED_BY_PROVIDER', provider: { ...assignment().provider, firstName: 'Rəşad', lastName: 'Quliyev' } })],
      cancelPenaltyPreview: 1500,
    });
    const api = signedInCustomer({
      extra: [
        on('GET', '/requests/:id', () => ok(current)),
        on('POST', '/requests/:id/cancel', () => {
          current = { ...current, status: 'CANCELLED', canCancel: false, isSearching: false, cancelledAt: '2026-10-25T10:20:00.000Z' };
          return ok(current);
        }),
      ],
    });
    await renderRouter(APP_DIR, { initialUrl: `/request/${IDS.request}` });
    await waitFor(() => expect(screen.getByTestId('request-detail-screen')).toBeTruthy());
    expect(screen.getByText('#1042')).toBeTruthy();
    expect(screen.getByText('giriş 2, mərtəbə 5, mənzil 12')).toBeTruthy();
    expect(screen.getByText('Ustalar (1 / 2)')).toBeTruthy();
    expect(within(screen.getByTestId('detail-slot-0')).getByText('Elvin Məmmədov')).toBeTruthy();
    expect(within(screen.getByTestId('detail-slot-1')).getByText('Axtarılır')).toBeTruthy();
    // The provider who cancelled stays visible as history.
    expect(within(screen.getByTestId(`detail-past-${A2}`)).getByText('Usta ləğv etdi')).toBeTruthy();
    // Still searching for the second handyman: a link to the live search.
    expect(screen.getByTestId('detail-searching')).toBeTruthy();
    expect(screen.queryByText(/\+994/)).toBeNull();

    await fireEvent.press(screen.getByTestId('detail-cancel'));
    expect(screen.getByText('Ləğv etsəniz balansınızdan 15,00 ₼ cərimə tutulacaq.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('detail-cancel-confirm'));
    await waitFor(() => expect(within(screen.getByTestId('detail-status')).getByText('Ləğv edildi')).toBeTruthy());
    expect(api.find('POST', `/requests/${IDS.request}/cancel`)).toHaveLength(1);
    expect(screen.queryByTestId('detail-cancel')).toBeNull();
  });

  it('a scheduled request explains that providers will accept it later', async () => {
    signedInCustomer({ extra: [on('GET', '/requests/:id', () => ok(detail({ timing: 'SCHEDULED', scheduledAt: '2026-10-26T08:30:00.000Z' })))] });
    await renderRouter(APP_DIR, { initialUrl: `/request/${IDS.request}` });
    await waitFor(() => expect(screen.getByTestId('detail-scheduled')).toBeTruthy());
    expect(screen.getByText('Planla · 26.10.2026, 12:30')).toBeTruthy();
    expect(screen.queryByTestId('detail-searching')).toBeNull();
  });
});
