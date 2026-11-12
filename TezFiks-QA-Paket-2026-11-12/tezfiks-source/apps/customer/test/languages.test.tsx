import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import path from 'node:path';
import { me, secureStore } from './helpers';
import { IDS, detail, summary } from './fixtures';
import { flush, ok, on, resetApp, serverEmit, signedInCustomer } from './screen-helpers';

const APP_DIR = path.join(__dirname, '..', 'src', 'app');

describe('customer screens in Russian and English, realtime refresh', () => {
  beforeEach(() => resetApp());

  it('Russian: home strings, plural category count and Accept-Language on API calls', async () => {
    const api = signedInCustomer();
    secureStore().set('tf.language', 'ru');
    await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(screen.getByText('Здравствуйте, Nizami')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('Все категории (10 категорий)')).toBeTruthy());
    expect(screen.getByText('Найти по фото')).toBeTruthy();
    expect(screen.getByText('Категории услуг')).toBeTruthy();
    expect(api.find('GET', '/categories').some((c) => c.headers['Accept-Language'] === 'ru')).toBe(true);
  });

  it('English: request form labels', async () => {
    signedInCustomer();
    secureStore().set('tf.language', 'en');
    await renderRouter(APP_DIR, { initialUrl: `/request/new?categoryId=${IDS.plumbing}` });
    await waitFor(() => expect(screen.getByText('New order')).toBeTruthy());
    expect(screen.getByText('Call a handyman')).toBeTruthy();
    expect(screen.getByTestId('request-slots-value').props.children).toBe('1 handyman');
    await fireEvent.press(screen.getByTestId('request-slots-inc'));
    expect(screen.getByTestId('request-slots-value').props.children).toBe('2 handymen');
    await fireEvent.press(screen.getByTestId('request-submit'));
    expect(screen.getAllByText('Describe the problem briefly (at least 3 characters)').length).toBeGreaterThan(0);
  });

  it('the app saves its language on the server when it differs from the profile (pushes arrive in the app language)', async () => {
    const api = signedInCustomer({ extra: [on('PATCH', '/me', (c) => ok(me({ ...(c.body as object), customer: { id: IDS.account, type: 'INDIVIDUAL', companyName: null } })))] });
    secureStore().set('tf.language', 'en');
    await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(screen.getByText('Hello, Nizami')).toBeTruthy());
    await waitFor(() => expect(api.find('PATCH', '/me')).toHaveLength(1));
    expect(api.find('PATCH', '/me')[0].body).toEqual({ locale: 'en' });
    await flush(100);
    expect(api.find('PATCH', '/me')).toHaveLength(1);
  });

  it('no language call when the profile already has the app language', async () => {
    const api = signedInCustomer();
    secureStore().set('tf.language', 'az');
    await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(screen.getByText('Salam, Nizami')).toBeTruthy());
    await flush(100);
    expect(api.find('PATCH', '/me')).toHaveLength(0);
  });

  it('English: the emergency fee is held and refunded when no handyman is found', async () => {
    signedInCustomer();
    secureStore().set('tf.language', 'en');
    await renderRouter(APP_DIR, { initialUrl: `/request/new?categoryId=${IDS.plumbing}` });
    await waitFor(() => expect(screen.getByTestId('request-timing-EMERGENCY')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('request-timing-EMERGENCY'));
    await waitFor(() =>
      expect(screen.getByText('Emergency call: +₼5 per handyman, ₼5 in total. The amount is held on your balance and refunded if no handyman is found.')).toBeTruthy(),
    );
  });

  it('request:updated over the socket refreshes the orders list', async () => {
    let status: 'SEARCHING' | 'ASSIGNED' = 'SEARCHING';
    signedInCustomer({
      extra: [
        on('GET', '/requests', (c) => ok({ items: c.query.scope === 'active' ? [summary({ status, isSearching: status === 'SEARCHING' })] : [], nextCursor: null })),
        on('GET', '/requests/:id', () => ok(detail())),
      ],
    });
    secureStore().set('tf.language', 'az');
    await renderRouter(APP_DIR, { initialUrl: '/orders' });
    await waitFor(() => expect(screen.getByText('Usta axtarılır')).toBeTruthy());
    status = 'ASSIGNED';
    await serverEmit('request:updated', { requestId: IDS.request, status: 'ASSIGNED' });
    await waitFor(() => expect(screen.getByText('Usta təyin edildi')).toBeTruthy());
  });
});
