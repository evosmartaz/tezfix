import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import path from 'node:path';
import { Linking } from 'react-native';
import { header, resetApp, UUID } from './pro-helpers';
import { assignment, earnings, ledgerTx, proProfile, wallet } from './fixtures';
import { apiError, installPro, ok, on, WORKER_ME } from './m4-helpers';

const APP_DIR = path.join(__dirname, '..', 'src', 'app');

afterEach(() => resetApp());

describe('orders tab: active and history', () => {
  it('lists active jobs, switches to history and opens a job', async () => {
    const active = assignment({ id: UUID(501), requestNumber: 3001, status: 'EN_ROUTE' });
    const done = assignment({
      id: UUID(502),
      requestNumber: 2990,
      status: 'COMPLETED',
      completedAt: '2026-10-24T12:00:00.000Z',
      price: { labor: 3500, materials: 1000, total: 4500 },
    });
    const world = installPro({ assignments: [active, done] });
    const r = await renderRouter(APP_DIR, { initialUrl: '/orders' });
    await waitFor(() => expect(screen.getByTestId('orders-list-active')).toBeTruthy());
    expect(screen.getByText('#3001 · Santexnik — kran təmiri')).toBeTruthy();
    expect(screen.queryByText(/#2990/)).toBeNull();
    expect(screen.getByTestId('orders-scheduled')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('orders-scope-history'));
    await waitFor(() => expect(screen.getByTestId('orders-list-history')).toBeTruthy());
    expect(screen.getByTestId(`order-price-${done.id}`).props.children).toMatch(/^45,00\s₼$/);
    expect(world.calls.some((c) => c.path.startsWith('/pro/assignments?') && c.path.includes('scope=history'))).toBe(true);

    await fireEvent.press(screen.getByTestId(`order-${done.id}`));
    await waitFor(() => expect(r.getPathname()).toBe(`/job/${done.id}`));
  });

  it('a company worker never sees prices in the list', async () => {
    const job = assignment({
      id: UUID(503),
      view: 'WORKER_LIMITED',
      providerType: 'COMPANY',
      status: 'COMPLETED',
      price: { labor: 3500, materials: 1000, total: 4500 },
    });
    installPro({ me: { handyman: WORKER_ME }, profile: proProfile({ kind: 'COMPANY_WORKER', company: { id: UUID(9), name: 'FixPro MMC', finalPriceEntry: 'MANAGER' }, wallet: null }), assignments: [job] });
    await renderRouter(APP_DIR, { initialUrl: '/orders' });
    await waitFor(() => expect(screen.getByTestId('orders-scope-history')).toBeTruthy());
    expect(screen.queryByTestId('orders-scheduled')).toBeNull();
    await fireEvent.press(screen.getByTestId('orders-scope-history'));
    await waitFor(() => expect(screen.getByTestId(`order-${job.id}`)).toBeTruthy());
    expect(screen.queryByTestId(`order-price-${job.id}`)).toBeNull();
    expect(screen.queryByText(/45,00/)).toBeNull();
  });
});

describe('home and orders tabs share the active jobs cache', () => {
  it('opening Sifarişlər after Home lists the running job (no cache shape clash)', async () => {
    const running = assignment({ id: UUID(511), requestNumber: 3101, status: 'EN_ROUTE' });
    const world = installPro({ assignments: [running] });
    const r = await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(screen.getByTestId('home-active-job')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('tab-orders'));
    await waitFor(() => expect(r.getPathname()).toBe('/orders'));
    await waitFor(() => expect(screen.getByTestId('orders-list-active')).toBeTruthy());
    expect(screen.getByTestId(`order-${running.id}`)).toBeTruthy();

    // Back on Home the shortcut still renders from the same cache entry.
    await fireEvent.press(screen.getByTestId('tab-home'));
    await waitFor(() => expect(r.getPathname()).toBe('/'));
    expect(screen.getByTestId('home-active-job')).toBeTruthy();
    expect(world.calls.filter((c) => c.method === 'GET' && c.path.startsWith('/pro/assignments?')).length).toBeGreaterThan(0);
  });

  it('opening Home after Sifarişlər still shows the running job shortcut', async () => {
    const running = assignment({ id: UUID(512), requestNumber: 3102, status: 'ARRIVED' });
    installPro({ assignments: [running] });
    const r = await renderRouter(APP_DIR, { initialUrl: '/orders' });
    await waitFor(() => expect(screen.getByTestId(`order-${running.id}`)).toBeTruthy());

    await fireEvent.press(screen.getByTestId('tab-home'));
    await waitFor(() => expect(r.getPathname()).toBe('/'));
    await waitFor(() => expect(screen.getByTestId('home-active-job')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('home-active-job'));
    await waitFor(() => expect(r.getPathname()).toBe(`/job/${running.id}`));
  });

  it('a company worker can open Sifarişlər after Home', async () => {
    const job = assignment({ id: UUID(513), view: 'WORKER_LIMITED', providerType: 'COMPANY', status: 'ACCEPTED' });
    installPro({
      me: { handyman: WORKER_ME },
      profile: proProfile({ kind: 'COMPANY_WORKER', company: { id: UUID(9), name: 'FixPro MMC', finalPriceEntry: 'MANAGER' }, wallet: null }),
      assignments: [job],
    });
    const r = await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(screen.getByTestId('home-active-job')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('tab-orders'));
    await waitFor(() => expect(r.getPathname()).toBe('/orders'));
    await waitFor(() => expect(screen.getByTestId(`order-${job.id}`)).toBeTruthy());
  });
});

describe('balance (board 03 B5)', () => {
  it('shows the current balance, the low balance warning and the transaction history', async () => {
    installPro({
      routes: [
        on('GET', '/wallet', (_c, _m, q) => (q.owner === 'handyman' ? ok(wallet(800)) : apiError(400, 'VALIDATION_FAILED'))),
        on('GET', '/wallet/transactions', () =>
          ok({
            items: [
              ledgerTx(1, { kind: 'REQUEST_FEE_CAPTURE', amount: -1000, requestNumber: 2847 }),
              ledgerTx(2, { kind: 'TOPUP', amount: 5000, requestNumber: null }),
            ],
            nextCursor: null,
          }),
        ),
      ],
    });
    await renderRouter(APP_DIR, { initialUrl: '/balance' });
    await waitFor(() => expect(screen.getByTestId('wallet-available')).toBeTruthy());
    expect(screen.getByTestId('wallet-available').props.children).toMatch(/^8,00\s₼$/);
    expect(screen.getByTestId('wallet-low')).toBeTruthy();
    expect(screen.getByText(/^Balans 10\s₼-dən az olduqda yeni sifariş qəbul edə bilməzsiniz$/)).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('wallet-tx')).toBeTruthy());
    const fee = screen.getByTestId(`tx-amount-${UUID(1001)}`).props.children as string;
    expect(fee).toMatch(/^-10,00\s₼$/);
    expect(screen.getByTestId(`tx-amount-${UUID(1002)}`).props.children).toMatch(/^\+50,00\s₼$/);
    expect(screen.getByText(/^Sifariş #2847 — /)).toBeTruthy();
  });

  it('"+ Balansı artır": test checkout with an idempotency key, then polls the payment until it succeeds', async () => {
    let status = 'CREATED';
    let available = 800;
    const world = installPro({
      routes: [
        on('GET', '/wallet', () => ok(wallet(available))),
        on('GET', '/wallet/transactions', () => ok({ items: [], nextCursor: null })),
        on('POST', '/wallet/topup', () => ok({ paymentIntentId: UUID(7000), checkoutUrl: 'http://10.0.2.2:3000/tezfix/api/pay/checkout/x?t=abc' })),
        on('GET', `/payments/${UUID(7000)}`, () =>
          ok({
            id: UUID(7000),
            purpose: 'WALLET_TOPUP',
            amount: 5000,
            currency: 'AZN',
            status,
            provider: 'test',
            createdAt: new Date().toISOString(),
            completedAt: null,
            failureReason: null,
            checkoutUrl: null,
          }),
        ),
      ],
    });
    await renderRouter(APP_DIR, { initialUrl: '/balance' });
    await waitFor(() => expect(screen.getByTestId('wallet-topup')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('wallet-topup'));
    await waitFor(() => expect(screen.getByTestId('topup-preset-50')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('topup-preset-50'));
    await fireEvent.press(screen.getByTestId('topup-pay'));
    await waitFor(() => expect(screen.getByTestId('topup-pending')).toBeTruthy());
    const post = world.calls.find((c) => c.method === 'POST' && c.path === '/wallet/topup')!;
    expect(post.body).toEqual({ amount: 5000, owner: 'handyman', returnUrl: 'tezfiksusta://payment' });
    expect(header(post, 'Idempotency-Key')).toBeTruthy();
    expect(Linking.openURL).toHaveBeenCalledWith('http://10.0.2.2:3000/tezfix/api/pay/checkout/x?t=abc');

    status = 'SUCCEEDED';
    available = 5800;
    await waitFor(() => expect(screen.getByText(/^Balans artırıldı: 50,00\s₼$/)).toBeTruthy(), { timeout: 8000 });
    await waitFor(() => expect(screen.getByTestId('wallet-available').props.children).toMatch(/^58,00\s₼$/));
  });

  // The sheet is an RN Modal above the toast host: failures must be shown inside it.
  it('a declined test card is shown inside the top-up sheet, and the form is back for another try', async () => {
    // every checkout is a new payment intent (a new Idempotency-Key per attempt)
    const statuses: Record<string, string> = {};
    const world = installPro({
      routes: [
        on('GET', '/wallet', () => ok(wallet(800))),
        on('GET', '/wallet/transactions', () => ok({ items: [], nextCursor: null })),
        on('POST', '/wallet/topup', () => {
          const id = UUID(7001 + Object.keys(statuses).length);
          statuses[id] = 'CREATED';
          return ok({ paymentIntentId: id, checkoutUrl: 'http://10.0.2.2:3000/tezfix/api/pay/checkout/y?t=def' });
        }),
        on('GET', /^\/payments\/([^/]+)$/, (_c, m) =>
          ok({
            id: m![1],
            purpose: 'WALLET_TOPUP',
            amount: 2000,
            currency: 'AZN',
            status: statuses[m![1]!],
            provider: 'test',
            createdAt: new Date().toISOString(),
            completedAt: null,
            failureReason: statuses[m![1]!] === 'FAILED' ? 'card_declined' : null,
            checkoutUrl: null,
          }),
        ),
      ],
    });
    await renderRouter(APP_DIR, { initialUrl: '/balance' });
    await waitFor(() => expect(screen.getByTestId('wallet-topup')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('wallet-topup'));
    await waitFor(() => expect(screen.getByTestId('topup-pay')).toBeTruthy());
    expect(screen.queryByTestId('topup-error')).toBeNull();
    await fireEvent.press(screen.getByTestId('topup-pay'));
    await waitFor(() => expect(screen.getByTestId('topup-pending')).toBeTruthy());

    statuses[UUID(7001)] = 'FAILED';
    await waitFor(() => expect(within(screen.getByTestId('topup-sheet')).getByTestId('topup-error')).toBeTruthy(), { timeout: 8000 });
    const sheet = within(screen.getByTestId('topup-sheet'));
    expect(sheet.getByText('Ödəniş alınmadı')).toBeTruthy();
    expect(sheet.getByText('Kart rədd edildi və ya ödəniş ləğv olundu. Balans dəyişmədi — yenidən cəhd edin.')).toBeTruthy();
    expect(screen.getAllByText('Ödəniş alınmadı')).toHaveLength(1); // not a toast hidden behind the sheet
    expect(sheet.getByTestId('topup-pay')).toBeTruthy();

    // another try clears the message and starts a new checkout
    await fireEvent.press(screen.getByTestId('topup-pay'));
    await waitFor(() => expect(world.calls.filter((c) => c.method === 'POST' && c.path === '/wallet/topup')).toHaveLength(2));
    await waitFor(() => expect(screen.queryByTestId('topup-error')).toBeNull());
  });

  it('a failed top-up request is shown inside the sheet', async () => {
    installPro({
      routes: [
        on('GET', '/wallet', () => ok(wallet(800))),
        on('GET', '/wallet/transactions', () => ok({ items: [], nextCursor: null })),
        on('POST', '/wallet/topup', () => apiError(503, 'INTERNAL')),
      ],
    });
    await renderRouter(APP_DIR, { initialUrl: '/balance' });
    await waitFor(() => expect(screen.getByTestId('wallet-topup')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('wallet-topup'));
    await waitFor(() => expect(screen.getByTestId('topup-pay')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('topup-pay'));
    await waitFor(() => expect(within(screen.getByTestId('topup-sheet')).getByTestId('topup-error')).toBeTruthy());
    expect(screen.queryByTestId('topup-pending')).toBeNull();
  });

  it('rejects an amount outside 1..1000 AZN without calling the API', async () => {
    const world = installPro({
      routes: [on('GET', '/wallet', () => ok(wallet(3400))), on('GET', '/wallet/transactions', () => ok({ items: [], nextCursor: null }))],
    });
    await renderRouter(APP_DIR, { initialUrl: '/balance' });
    await waitFor(() => expect(screen.getByTestId('wallet-topup')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('wallet-topup'));
    await waitFor(() => expect(screen.getByTestId('topup-amount')).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('topup-amount'), '1500');
    await fireEvent.press(screen.getByTestId('topup-pay'));
    await waitFor(() => expect(screen.getByText('Maksimum 1000 AZN')).toBeTruthy());
    expect(world.calls.some((c) => c.path === '/wallet/topup')).toBe(false);
  });

  it('company workers have no wallet: the tab explains who pays', async () => {
    const world = installPro({ me: { handyman: WORKER_ME }, profile: proProfile({ kind: 'COMPANY_WORKER', company: { id: UUID(9), name: 'FixPro MMC', finalPriceEntry: 'MANAGER' }, wallet: null }) });
    await renderRouter(APP_DIR, { initialUrl: '/balance' });
    await waitFor(() => expect(screen.getByTestId('balance-worker')).toBeTruthy());
    expect(world.calls.some((c) => c.path.startsWith('/wallet'))).toBe(false);
  });
});

describe('earnings and payout card', () => {
  it('shows unpaid earnings, this week and payouts; saves a Luhn-valid payout card', async () => {
    let method: unknown = null;
    const world = installPro({
      routes: [
        on('GET', '/pro/earnings', () =>
          ok(
            earnings({
              pendingPayouts: 3000,
              payouts: [
                {
                  id: UUID(8000),
                  amount: 3000,
                  status: 'PAID',
                  periodStart: '2026-10-13T00:00:00.000Z',
                  periodEnd: '2026-10-20T00:00:00.000Z',
                  createdAt: '2026-10-20T05:00:00.000Z',
                  paidAt: '2026-10-21T05:00:00.000Z',
                  failureReason: null,
                  method: null,
                },
              ],
              payoutMethod: method as never,
            }),
          ),
        ),
        on('GET', '/pro/payout-method', () => ok({ method })),
        on('PUT', '/pro/payout-method', (c) => {
          const b = c.body as { holderName: string; number: string };
          method = { type: 'CARD', maskedNumber: `•••• ${b.number.slice(-4)}`, holderName: b.holderName, updatedAt: new Date().toISOString() };
          return ok(method);
        }),
      ],
    });
    const r = await renderRouter(APP_DIR, { initialUrl: '/earnings' });
    await waitFor(() => expect(screen.getByTestId('earnings-balance')).toBeTruthy());
    expect(screen.getByTestId('earnings-balance').props.children).toMatch(/^120,00\s₼$/);
    expect(screen.getByText(/^Ödəniş prosesində: 30,00\s₼$/)).toBeTruthy();
    expect(screen.getByText(/^Kartla: 2 iş • 90,00\s₼$/)).toBeTruthy();
    expect(screen.getByText(/^Bəxşişlər: 5,00\s₼$/)).toBeTruthy();
    expect(screen.getByTestId(`payout-${UUID(8000)}`)).toBeTruthy();
    expect(screen.getByText('Ödəniş kartı əlavə edilməyib')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('earnings-method-edit'));
    await waitFor(() => expect(r.getPathname()).toBe('/payout-method'));
    await fireEvent.changeText(screen.getByTestId('payout-number'), '4242 4242 4242 4241');
    await fireEvent.changeText(screen.getByTestId('payout-holder'), 'Elvin Məmmədov');
    await fireEvent.press(screen.getByTestId('payout-save'));
    await waitFor(() => expect(screen.getByText('Kart nömrəsi düzgün deyil')).toBeTruthy());
    expect(world.calls.some((c) => c.method === 'PUT')).toBe(false);

    await fireEvent.changeText(screen.getByTestId('payout-number'), '4242424242424242');
    expect(screen.getByTestId('payout-number').props.value).toBe('4242 4242 4242 4242');
    await fireEvent.press(screen.getByTestId('payout-save'));
    await waitFor(() => expect(r.getPathname()).toBe('/earnings'));
    expect(world.calls.find((c) => c.method === 'PUT')!.body).toEqual({ type: 'CARD', number: '4242424242424242', holderName: 'Elvin Məmmədov' });
    await waitFor(() => expect(screen.getByTestId('earnings-method-value').props.children).toBe('•••• 4242 • Elvin Məmmədov'));
  });
});

describe('notifications and profile', () => {
  it('lists notifications, marks all read and opens the job from a notification', async () => {
    const world = installPro({
      assignments: [assignment({ id: UUID(510) })],
      routes: [
        on('GET', '/notifications', () =>
          ok({
            items: [
              {
                id: UUID(9001),
                type: 'ASSIGNMENT_CANCELLED',
                title: 'Sifariş ləğv edildi',
                body: 'Müştəri sifarişi ləğv etdi',
                data: { assignmentId: UUID(510) },
                readAt: null,
                createdAt: new Date().toISOString(),
              },
            ],
            nextCursor: null,
          }),
        ),
        on('POST', '/notifications/read', () => ok({ ok: true })),
      ],
    });
    const r = await renderRouter(APP_DIR, { initialUrl: '/notifications' });
    await waitFor(() => expect(screen.getByTestId(`notification-${UUID(9001)}`)).toBeTruthy());
    await fireEvent.press(screen.getByTestId('notifications-read-all'));
    await waitFor(() => expect(world.calls.find((c) => c.path === '/notifications/read')?.body).toEqual({ all: true }));
    await fireEvent.press(screen.getByTestId(`notification-${UUID(9001)}`));
    await waitFor(() => expect(r.getPathname()).toBe(`/job/${UUID(510)}`));
  });

  it('edits the work profile (trades, radius, base) and deletes the account', async () => {
    const world = installPro({
      routes: [
        on('GET', '/categories', () => ok({ items: [] })),
        on('PATCH', '/pro/profile', (c) => ok({ ...proProfile(), ...(c.body as object) })),
        on('DELETE', '/me', () => ok({ ok: true })),
      ],
    });
    const r = await renderRouter(APP_DIR, { initialUrl: '/profile' });
    await waitFor(() => expect(screen.getByTestId('profile-edit')).toBeTruthy());
    expect(screen.getByTestId('profile-notifications')).toBeTruthy();
    expect(screen.getByTestId('profile-earnings')).toBeTruthy();
    expect(screen.getByTestId('profile-payout')).toBeTruthy();
    expect(screen.getByTestId('profile-projects')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('profile-edit'));
    await waitFor(() => expect(screen.getByTestId('profile-edit-save')).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId('profile-edit-screen')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('profile-edit-save'));
    await waitFor(() => expect(world.calls.some((c) => c.method === 'PATCH' && c.path === '/pro/profile')).toBe(true));
    expect(world.calls.find((c) => c.method === 'PATCH')!.body).toEqual({
      tradeIds: ['00000000-0000-4000-8000-0000000000c1'],
      serviceRadiusKm: 10,
      base: { lat: 40.4093, lng: 49.8671 },
    });
    await waitFor(() => expect(r.getPathname()).toBe('/profile'));

    await fireEvent.press(screen.getByTestId('profile-delete'));
    await waitFor(() => expect(screen.getByTestId('profile-delete-confirm')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('profile-delete-confirm'));
    await waitFor(() => expect(world.calls.some((c) => c.method === 'DELETE' && c.path === '/me')).toBe(true));
    await waitFor(() => expect(r.getPathname()).toBe('/phone'));
  });
});
