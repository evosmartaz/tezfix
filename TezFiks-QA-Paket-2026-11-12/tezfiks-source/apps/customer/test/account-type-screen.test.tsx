import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import path from 'node:path';
import { me } from './helpers';
import { account, categories, PUBLIC_CONFIG } from './fixtures';
import { fakeApi, fail, ok, on, resetApp } from './screen-helpers';
import { secureStore } from './helpers';

const APP_DIR = path.join(__dirname, '..', 'src', 'app');

function session(onUpsert: (body: Record<string, unknown>) => { status: number; body?: unknown }) {
  secureStore().set('tf.refreshToken', 'refresh-old');
  let current = me({ customer: null });
  const api = fakeApi([
    on('POST', '/auth/refresh', () =>
      ok({ accessToken: 'a2', refreshToken: 'r2', accessExpiresAt: '2026-10-25T10:15:00.000Z', refreshExpiresAt: '2026-11-24T10:00:00.000Z' }),
    ),
    on('GET', '/me', () => ok(current)),
    on('POST', '/me/devices', () => ok({ ok: true })),
    on('POST', '/customer/account', (c) => {
      const res = onUpsert(c.body as Record<string, unknown>);
      if (res.status === 200) {
        const b = c.body as { type: 'INDIVIDUAL' | 'COMPANY'; companyName?: string };
        current = me({ customer: { id: account().id, type: b.type, companyName: b.companyName ?? null } });
      }
      return res;
    }),
    on('GET', '/categories', () => ok({ items: categories() })),
    on('GET', '/config/public', () => ok(PUBLIC_CONFIG)),
    on('GET', '/requests', () => ok({ items: [], nextCursor: null })),
  ]);
  return api;
}

describe('account type screen (board 02 A3)', () => {
  beforeEach(() => resetApp());

  it('an individual account is created with one tap and opens the home tabs', async () => {
    const api = session((b) => ok(account({ type: b.type as 'INDIVIDUAL' })));
    const r = await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(screen.getByTestId('account-type-screen')).toBeTruthy());
    expect(r.getPathname()).toBe('/account-type');
    expect(screen.getByText('Fərdi hesab')).toBeTruthy();
    expect(screen.getByText('Şirkət hesabı')).toBeTruthy();
    expect(screen.queryByTestId('account-company-fields')).toBeNull();

    await fireEvent.press(screen.getByTestId('account-type-submit'));
    await waitFor(() => expect(screen.getByTestId('home-screen')).toBeTruthy());
    expect(r.getPathname()).toBe('/');
    expect(api.find('POST', '/customer/account')[0].body).toEqual({ type: 'INDIVIDUAL' });
  });

  it('a company account validates name and VÖEN, then sends the company fields', async () => {
    const api = session((b) => ok(account({ type: 'COMPANY', companyName: String(b.companyName), voen: String(b.voen), legalForm: 'ASC', contactPerson: 'Nizami Tağızadə' })));
    await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(screen.getByTestId('account-type-screen')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('account-type-COMPANY'));
    expect(screen.getByTestId('account-company-fields')).toBeTruthy();
    // The contact person is prefilled with the user's name.
    expect(screen.getByTestId('account-contact').props.value).toBe('Nizami Tağızadə');

    await fireEvent.press(screen.getByTestId('account-type-submit'));
    expect(screen.getByText('Şirkət adını daxil edin')).toBeTruthy();
    expect(screen.getByText('VÖEN daxil edin')).toBeTruthy();
    expect(api.find('POST', '/customer/account')).toHaveLength(0);

    await fireEvent.changeText(screen.getByTestId('account-company-name'), 'Şəfəq İnşaat');
    await fireEvent.changeText(screen.getByTestId('account-voen'), '12345abc');
    expect(screen.getByTestId('account-voen').props.value).toBe('12345');
    await fireEvent.press(screen.getByTestId('account-type-submit'));
    expect(screen.getByText('VÖEN 10 rəqəmdən ibarət olmalıdır')).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId('account-voen'), '1234567890');
    await fireEvent.press(screen.getByTestId('account-legal-ASC'));
    await fireEvent.press(screen.getByTestId('account-type-submit'));
    await waitFor(() => expect(screen.getByTestId('home-screen')).toBeTruthy());
    expect(api.find('POST', '/customer/account')[0].body).toEqual({
      type: 'COMPANY',
      companyName: 'Şəfəq İnşaat',
      voen: '1234567890',
      legalForm: 'ASC',
      contactPerson: 'Nizami Tağızadə',
    });
  });

  it('a VÖEN already registered shows a localized error and stays on the screen', async () => {
    session(() => fail(409, 'CONFLICT'));
    const r = await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(screen.getByTestId('account-type-screen')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('account-type-COMPANY'));
    await fireEvent.changeText(screen.getByTestId('account-company-name'), 'Kontur');
    await fireEvent.changeText(screen.getByTestId('account-voen'), '1234567890');
    await fireEvent.press(screen.getByTestId('account-type-submit'));
    await waitFor(() => expect(screen.getByText('Bu VÖEN ilə hesab artıq mövcuddur')).toBeTruthy());
    expect(screen.getByTestId('account-type-error')).toBeTruthy();
    expect(r.getPathname()).toBe('/account-type');
  });
});
