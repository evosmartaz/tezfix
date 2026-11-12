import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import path from 'node:path';
import { IDS, account, assignment, detail, summary } from './fixtures';
import { ok, on, resetApp, signedInCustomer } from './screen-helpers';

const APP_DIR = path.join(__dirname, '..', 'src', 'app');

describe('customer home (board 02 B1/B2)', () => {
  beforeEach(() => resetApp());

  it('greets, shows the reverse-geocoded location, six HOME tiles and the all-categories link', async () => {
    const api = signedInCustomer({
      extra: [
        on('GET', '/geo/reverse', () =>
          ok({ lat: 40.4093, lng: 49.8671, formatted: 'Atatürk pr. 45, Bakı', placeId: null, district: 'Nərimanov', street: 'Atatürk pr.', building: '45', source: 'fallback' }),
        ),
      ],
    });
    await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(screen.getByText('Salam, Nizami')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('Nərimanov, Atatürk pr.')).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId('category-tile-plumbing')).toBeTruthy());
    for (const slug of ['plumbing', 'electrical', 'air-conditioning', 'doors-locks', 'painting', 'furniture']) {
      expect(screen.getByTestId(`category-tile-${slug}`)).toBeTruthy();
    }
    expect(screen.queryByTestId('category-tile-battery')).toBeNull();
    // 10 active services in the fixture catalogue (the inactive one and the groups are not counted).
    expect(screen.getByText('Bütün kateqoriyalar (10 kateqoriya)')).toBeTruthy();
    expect(screen.getByText('Şəkil ilə tap')).toBeTruthy();
    // Unknown icon names fall back to a generic glyph.
    expect(screen.getAllByText('icon:tools').length).toBeGreaterThan(0);
    const reverse = api.find('GET', '/geo/reverse')[0];
    expect(reverse.query).toEqual({ lat: '40.4093', lng: '49.8671' });
  });

  it('the Avto ustaları toggle shows the auto services and the on-site hint', async () => {
    signedInCustomer();
    await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(screen.getByTestId('category-tile-plumbing')).toBeTruthy());
    expect(screen.getByText('Bakı')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('home-vertical-AUTO'));
    expect(screen.getByTestId('category-tile-battery')).toBeTruthy();
    expect(screen.getByTestId('category-tile-towing')).toBeTruthy();
    expect(screen.queryByTestId('category-tile-plumbing')).toBeNull();
    expect(screen.getByTestId('home-auto-hint')).toBeTruthy();
    expect(screen.getByText('Maşına hansı usta lazımdır?')).toBeTruthy();
  });

  it('shows the active request banner and opens the searching screen', async () => {
    signedInCustomer({
      extra: [
        on('GET', '/requests', (c) => ok({ items: c.query.scope === 'active' ? [summary()] : [], nextCursor: null })),
        on('GET', '/requests/:id', () => ok(detail())),
      ],
    });
    const r = await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(screen.getByTestId('home-active-request')).toBeTruthy());
    expect(screen.getByText('Aktiv sifariş #1042')).toBeTruthy();
    expect(screen.getByText('Santexnik · Usta axtarılır')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('home-active-request'));
    await waitFor(() => expect(screen.getByTestId('searching-screen')).toBeTruthy());
    expect(r.getPathname()).toBe(`/request/${IDS.request}/searching`);
  });

  it('an assigned request with one handyman: the banner opens his live tracking (spec B5), not the static detail', async () => {
    signedInCustomer({
      extra: [
        on('GET', '/requests', (c) => ok({ items: c.query.scope === 'active' ? [summary({ status: 'ASSIGNED', isSearching: false, slotsFilled: 1 })] : [], nextCursor: null })),
        on('GET', '/requests/:id', () =>
          ok(detail({ status: 'ASSIGNED', isSearching: false, slotsFilled: 1, search: null, slots: [{ index: 0, status: 'FILLED', assignmentId: IDS.assignment }], assignments: [assignment({ status: 'EN_ROUTE' })] })),
        ),
        on('GET', '/assignments/:id', () => ok(assignment({ status: 'EN_ROUTE' }))),
      ],
    });
    const r = await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(screen.getByTestId('home-active-request')).toBeTruthy());
    expect(screen.getByText('Santexnik · Usta təyin edildi')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('home-active-request'));
    await waitFor(() => expect(r.getPathname()).toBe(`/assignment/${IDS.assignment}`));
    await waitFor(() => expect(screen.getByTestId('tracking-screen')).toBeTruthy());
  });

  it('a request with two working handymen: the banner opens the request detail', async () => {
    const second = '50000000-0000-4000-a000-000000000002';
    signedInCustomer({
      extra: [
        on('GET', '/requests', (c) =>
          ok({ items: c.query.scope === 'active' ? [summary({ status: 'IN_PROGRESS', isSearching: false, slotsRequested: 2, slotsFilled: 2 })] : [], nextCursor: null }),
        ),
        on('GET', '/requests/:id', () =>
          ok(
            detail({
              status: 'IN_PROGRESS',
              isSearching: false,
              slotsRequested: 2,
              slotsFilled: 2,
              search: null,
              slots: [
                { index: 0, status: 'FILLED', assignmentId: IDS.assignment },
                { index: 1, status: 'FILLED', assignmentId: second },
              ],
              assignments: [assignment({ status: 'ARRIVED' }), assignment({ id: second, slotIndex: 1, status: 'EN_ROUTE' })],
            }),
          ),
        ),
      ],
    });
    const r = await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(screen.getByTestId('home-active-request')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('home-active-request'));
    await waitFor(() => expect(r.getPathname()).toBe(`/request/${IDS.request}`));
    await waitFor(() => expect(screen.getByTestId('request-detail-screen')).toBeTruthy());
  });

  it('when the request detail cannot be loaded, the banner still opens the request detail screen', async () => {
    signedInCustomer({
      extra: [
        on('GET', '/requests', (c) => ok({ items: c.query.scope === 'active' ? [summary({ status: 'ASSIGNED', isSearching: false, slotsFilled: 1 })] : [], nextCursor: null })),
        on('GET', '/requests/:id', () => ({ status: 500, body: { error: { code: 'INTERNAL', message: 'x' } } })),
      ],
    });
    const r = await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(screen.getByTestId('home-active-request')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('home-active-request'));
    await waitFor(() => expect(r.getPathname()).toBe(`/request/${IDS.request}`));
  });

  it('a wallet in debt shows the debt banner with a top-up action', async () => {
    signedInCustomer({ account: account({ wallet: { accountId: IDS.wallet, currency: 'AZN', posted: -1500, held: 0, available: -1500, isDebt: true, lowBalance: true } }) });
    const r = await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(screen.getByTestId('home-debt')).toBeTruthy());
    expect(screen.getByText('Borc: 15,00 ₼. Yeni sifariş üçün balansı artırın')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('home-debt-topup'));
    await waitFor(() => expect(screen.getByTestId('wallet-screen')).toBeTruthy());
    expect(r.getPathname()).toBe('/wallet');
  });

  it('a tile opens the request form for that service; search opens all categories', async () => {
    signedInCustomer();
    const r = await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(screen.getByTestId('category-tile-plumbing')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('category-tile-plumbing'));
    await waitFor(() => expect(screen.getByTestId('create-request-screen')).toBeTruthy());
    expect(r.getPathname()).toBe('/request/new');
    expect(r.getSearchParams()).toMatchObject({ categoryId: IDS.plumbing });
    expect(screen.getAllByText('Santexnik').length).toBeGreaterThan(0);
  });

  it('search on home opens the category browser, which folds Azerbaijani letters', async () => {
    signedInCustomer();
    const r = await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(screen.getByTestId('home-search')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('home-search'));
    await waitFor(() => expect(screen.getByTestId('categories-screen')).toBeTruthy());
    expect(r.getPathname()).toBe('/categories');
    await waitFor(() => expect(screen.getByText('Ev sistemləri')).toBeTruthy());
    expect(screen.getByText('Tamamlama və dizayn')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('category-search'), 'QAPI');
    expect(screen.getByTestId('category-tile-doors-locks')).toBeTruthy();
    expect(screen.queryByTestId('category-tile-plumbing')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('category-search'), 'zzzz');
    expect(screen.getByTestId('category-no-results')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('category-search'), 'кран');
    await fireEvent.press(screen.getByTestId('category-tile-plumbing'));
    await waitFor(() => expect(screen.getByTestId('create-request-screen')).toBeTruthy());
    expect(r.getSearchParams()).toMatchObject({ categoryId: IDS.plumbing });
  });
});
