import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import path from 'node:path';
import type { SavedAddress } from '@tezfiks/shared';
import { ADDRESS, IDS, account } from './fixtures';
import { M3, caseView, intent, notification } from './fixtures-m3';
import { me, secureStore } from './helpers';
import { fail, ok, on, resetApp, serverEmit, signedInCustomer } from './screen-helpers';

const APP_DIR = path.join(__dirname, '..', 'src', 'app');

const saved = (over: Partial<SavedAddress> = {}): SavedAddress => ({ ...ADDRESS, id: IDS.address, label: 'Ev', isSite: false, createdAt: '2026-10-20T10:00:00.000Z', ...over });

describe('profile tab', () => {
  beforeEach(() => resetApp());

  it('header with name and phone, account type, links and the unread badge', async () => {
    signedInCustomer({ customerType: 'COMPANY', extra: [on('GET', '/notifications/unread-count', () => ok({ count: 3 }))] });
    await renderRouter(APP_DIR, { initialUrl: '/profile' });
    await waitFor(() => expect(screen.getByTestId('account-summary')).toBeTruthy());
    expect(screen.getByText('Nizami Tağızadə')).toBeTruthy();
    expect(screen.getByText('+994 50 123 45 67')).toBeTruthy();
    await waitFor(() => expect(within(screen.getByTestId('profile-company')).getByText('Şirkət hesabı')).toBeTruthy());
    await waitFor(() => expect(within(screen.getByTestId('profile-company')).getByText('Kontur MMC · VÖEN: 1234567890')).toBeTruthy());
    await waitFor(() => expect(within(screen.getByTestId('profile-unread')).getByText('3')).toBeTruthy());
    expect(screen.getByTestId('profile-addresses')).toBeTruthy();
    expect(screen.getByTestId('profile-projects')).toBeTruthy();
    expect(screen.getByTestId('profile-cases')).toBeTruthy();
    expect(screen.getByTestId('logout')).toBeTruthy();
  });

  it('edit name: PATCH /me with only the changed field, Azerbaijani letters intact', async () => {
    const api = signedInCustomer({ extra: [on('PATCH', '/me', (c) => ok(me({ ...(c.body as object), customer: { id: IDS.account, type: 'INDIVIDUAL', companyName: null } })))] });
    const r = await renderRouter(APP_DIR, { initialUrl: '/profile' });
    await waitFor(() => expect(screen.getByTestId('account-summary')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('account-summary'));
    await waitFor(() => expect(screen.getByTestId('profile-edit-screen')).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('profile-last-name'), '');
    await fireEvent.press(screen.getByTestId('profile-save'));
    expect(screen.getByText('Soyadınızı daxil edin')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('profile-last-name'), ' Əliyev ');
    await fireEvent.press(screen.getByTestId('profile-save'));
    await waitFor(() => expect(r.getPathname()).toBe('/profile'));
    expect(api.find('PATCH', '/me')[0].body).toEqual({ lastName: 'Əliyev' });
    await waitFor(() => expect(screen.getByText('Nizami Əliyev')).toBeTruthy());
  });

  it('switch to a company account with VÖEN validation', async () => {
    const api = signedInCustomer({
      extra: [on('POST', '/customer/account', (c) => ok(account({ ...(c.body as object), legalForm: 'MMC' } as never)))],
    });
    const r = await renderRouter(APP_DIR, { initialUrl: '/profile/company' });
    await waitFor(() => expect(screen.getByTestId('company-screen')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('company-type-COMPANY'));
    await fireEvent.changeText(screen.getByTestId('company-name'), 'Kontur MMC');
    await fireEvent.changeText(screen.getByTestId('company-voen'), '12345');
    await fireEvent.press(screen.getByTestId('company-save'));
    expect(screen.getByText('VÖEN 10 rəqəmdən ibarət olmalıdır')).toBeTruthy();
    expect(api.find('POST', '/customer/account')).toHaveLength(0);
    await fireEvent.changeText(screen.getByTestId('company-voen'), '1234567890');
    await fireEvent.press(screen.getByTestId('company-save'));
    await waitFor(() => expect(api.find('POST', '/customer/account')).toHaveLength(1));
    expect(api.find('POST', '/customer/account')[0].body).toMatchObject({ type: 'COMPANY', companyName: 'Kontur MMC', voen: '1234567890', legalForm: 'MMC' });
    await waitFor(() => expect(r.getPathname()).toBe('/profile'));
  });

  it('delete account: the confirmation word is required, then the session ends', async () => {
    const api = signedInCustomer({ extra: [on('DELETE', '/me', () => ok({ ok: true }))] });
    const r = await renderRouter(APP_DIR, { initialUrl: '/profile' });
    await waitFor(() => expect(screen.getByTestId('profile-delete')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('profile-delete'));
    expect(screen.getByText('Təsdiq üçün SİL yazın')).toBeTruthy();
    expect(screen.getByTestId('profile-delete-confirm')).toBeDisabled();
    await fireEvent.changeText(screen.getByTestId('profile-delete-input'), 'sil');
    await fireEvent.press(screen.getByTestId('profile-delete-confirm'));
    await waitFor(() => expect(api.find('DELETE', '/me')).toHaveLength(1));
    await waitFor(() => expect(r.getPathname()).toBe('/phone'));
    expect(secureStore().get('tf.refreshToken')).toBeUndefined();
    // The server already revoked the sessions: no remote logout call.
    expect(api.find('POST', '/auth/logout')).toHaveLength(0);
  });

  it('a failed delete keeps the user signed in with the error', async () => {
    signedInCustomer({ extra: [on('DELETE', '/me', () => fail(409, 'CONFLICT'))] });
    const r = await renderRouter(APP_DIR, { initialUrl: '/profile' });
    await waitFor(() => expect(screen.getByTestId('profile-delete')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('profile-delete'));
    await fireEvent.changeText(screen.getByTestId('profile-delete-input'), 'SİL');
    await fireEvent.press(screen.getByTestId('profile-delete-confirm'));
    await waitFor(() => expect(screen.getByText('Məlumat artıq dəyişib, yeniləyin')).toBeTruthy());
    expect(r.getPathname()).toBe('/profile');
  });

  it('the delete error is drawn above the open delete sheet (the modal covers the root toast host)', async () => {
    signedInCustomer({ extra: [on('DELETE', '/me', () => fail(409, 'CONFLICT'))] });
    await renderRouter(APP_DIR, { initialUrl: '/profile' });
    await waitFor(() => expect(screen.getByTestId('profile-delete')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('profile-delete'));
    await fireEvent.changeText(screen.getByTestId('profile-delete-input'), 'SİL');
    await fireEvent.press(screen.getByTestId('profile-delete-confirm'));
    await waitFor(() => expect(within(screen.getByTestId('profile-delete-sheet')).getByText('Məlumat artıq dəyişib, yeniləyin')).toBeTruthy());
    expect(screen.getAllByTestId('toast')).toHaveLength(1);
  });

  it('Russian profile texts', async () => {
    signedInCustomer();
    secureStore().set('tf.language', 'ru');
    await renderRouter(APP_DIR, { initialUrl: '/profile' });
    await waitFor(() => expect(screen.getByText('Мои адреса')).toBeTruthy());
    expect(screen.getByText('Удалить аккаунт')).toBeTruthy();
  });
});

describe('saved addresses', () => {
  beforeEach(() => resetApp());

  it('lists, renames and deletes saved addresses', async () => {
    let items = [saved(), saved({ id: M3.address, label: null, formatted: 'Nizami küç. 203', isSite: true })];
    const api = signedInCustomer({
      extra: [
        on('GET', '/customer/addresses', () => ok({ items })),
        on('PATCH', '/customer/addresses/:id', (c, p) => {
          items = items.map((a) => (a.id === p.id ? { ...a, ...(c.body as object) } : a));
          return ok(items.find((a) => a.id === p.id));
        }),
        on('DELETE', '/customer/addresses/:id', (_c, p) => {
          items = items.filter((a) => a.id !== p.id);
          return ok({ ok: true });
        }),
      ],
    });
    await renderRouter(APP_DIR, { initialUrl: '/addresses' });
    await waitFor(() => expect(screen.getByTestId(`address-${IDS.address}`)).toBeTruthy());
    expect(within(screen.getByTestId(`address-${IDS.address}`)).getByText('Ev')).toBeTruthy();
    expect(within(screen.getByTestId(`address-${IDS.address}`)).getByText('giriş 2, mərtəbə 5, mənzil 12')).toBeTruthy();
    await fireEvent.press(screen.getByTestId(`address-edit-${IDS.address}`));
    await fireEvent.changeText(screen.getByTestId('address-edit-label'), 'Anamgil');
    await fireEvent.press(screen.getByTestId('address-edit-save'));
    await waitFor(() => expect(api.find('PATCH', `/customer/addresses/${IDS.address}`)).toHaveLength(1));
    expect(api.find('PATCH', `/customer/addresses/${IDS.address}`)[0].body).toEqual({ label: 'Anamgil', isSite: false });
    await waitFor(() => expect(within(screen.getByTestId(`address-${IDS.address}`)).getByText('Anamgil')).toBeTruthy());

    await fireEvent.press(screen.getByTestId(`address-delete-${M3.address}`));
    await fireEvent.press(screen.getByTestId('address-delete-sheet-confirm'));
    await waitFor(() => expect(screen.queryByTestId(`address-${M3.address}`)).toBeNull());
    expect(api.find('DELETE', `/customer/addresses/${M3.address}`)).toHaveLength(1);
  });

  it('empty address book', async () => {
    signedInCustomer();
    await renderRouter(APP_DIR, { initialUrl: '/addresses' });
    await waitFor(() => expect(screen.getByTestId('addresses-empty')).toBeTruthy());
    expect(screen.getByText('Saxlanmış ünvan yoxdur')).toBeTruthy();
  });
});

describe('notifications', () => {
  beforeEach(() => resetApp());

  it('home bell shows the unread count; the list opens the job and marks it read', async () => {
    let unread = 2;
    const api = signedInCustomer({
      extra: [
        on('GET', '/notifications/unread-count', () => ok({ count: unread })),
        on('GET', '/notifications', () =>
          ok({ items: [notification(), notification({ id: M3.notification2, type: 'WALLET_TOPUP', title: 'Balans artırıldı', body: '20 ₼', data: {}, readAt: '2026-10-25T09:00:00.000Z' })], nextCursor: null }),
        ),
        on('POST', '/notifications/read', () => {
          unread = 0;
          return ok({ ok: true });
        }),
        on('GET', '/assignments/:id', () => ok(require('./fixtures-m3').enRoute())),
        on('GET', '/requests/:id', () => ok(require('./fixtures').detail())),
      ],
    });
    const r = await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(within(screen.getByTestId('home-bell-badge')).getByText('2')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('home-bell'));
    await waitFor(() => expect(screen.getByTestId(`notification-${M3.notification}`)).toBeTruthy());
    expect(screen.getByTestId(`notification-unread-${M3.notification}`)).toBeTruthy();
    expect(screen.queryByTestId(`notification-unread-${M3.notification2}`)).toBeNull();
    await fireEvent.press(screen.getByTestId(`notification-${M3.notification}`));
    await waitFor(() => expect(r.getPathname()).toBe(`/assignment/${IDS.assignment}`));
    expect(api.find('POST', '/notifications/read')[0].body).toEqual({ ids: [M3.notification] });
  });

  it('mark all read', async () => {
    const api = signedInCustomer({
      extra: [on('GET', '/notifications', () => ok({ items: [notification()], nextCursor: null })), on('POST', '/notifications/read', () => ok({ ok: true }))],
    });
    await renderRouter(APP_DIR, { initialUrl: '/notifications' });
    await waitFor(() => expect(screen.getByTestId('notifications-mark-all')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('notifications-mark-all'));
    await waitFor(() => expect(api.find('POST', '/notifications/read')).toHaveLength(1));
    expect(api.find('POST', '/notifications/read')[0].body).toEqual({ all: true });
  });

  it('notification:new refreshes the badge', async () => {
    let unread = 0;
    signedInCustomer({ extra: [on('GET', '/notifications/unread-count', () => ok({ count: unread }))] });
    await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(screen.getByTestId('home-bell')).toBeTruthy());
    expect(screen.queryByTestId('home-bell-badge')).toBeNull();
    unread = 1;
    await serverEmit('notification:new', notification());
    await waitFor(() => expect(within(screen.getByTestId('home-bell-badge')).getByText('1')).toBeTruthy());
  });

  it('empty list', async () => {
    signedInCustomer({ extra: [on('GET', '/notifications', () => ok({ items: [], nextCursor: null }))] });
    await renderRouter(APP_DIR, { initialUrl: '/notifications' });
    await waitFor(() => expect(screen.getByText('Bildiriş yoxdur')).toBeTruthy());
  });
});

describe('claims and payment landing', () => {
  beforeEach(() => resetApp());

  it('my claims list with status and decision', async () => {
    signedInCustomer({
      extra: [on('GET', '/cases', () => ok({ items: [caseView({ status: 'RESOLVED', resolutionNote: 'Usta yenidən göndərildi' })], nextCursor: null }))],
    });
    await renderRouter(APP_DIR, { initialUrl: '/cases' });
    await waitFor(() => expect(screen.getByTestId(`case-${M3.case}`)).toBeTruthy());
    expect(within(screen.getByTestId(`case-status-${M3.case}`)).getByText('Həll edildi')).toBeTruthy();
    expect(screen.getByText('Qərar: Usta yenidən göndərildi')).toBeTruthy();
    expect(screen.getByText(/TezFiks Zəmanəti · Sifariş #1042/)).toBeTruthy();
  });

  it('cold start from tezfiks://payment shows the settled top-up', async () => {
    signedInCustomer({ extra: [on('GET', '/payments/:id', () => ok(intent({ purpose: 'WALLET_TOPUP', amount: 2000, status: 'SUCCEEDED' })))] });
    const r = await renderRouter(APP_DIR, { initialUrl: `/payment?paymentIntentId=${M3.intent}&status=SUCCEEDED` });
    await waitFor(() => expect(screen.getByTestId('payment-status')).toBeTruthy());
    expect(screen.getByText('Ödəniş uğurla tamamlandı')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('payment-continue'));
    await waitFor(() => expect(r.getPathname()).toBe('/wallet'));
  });
});
