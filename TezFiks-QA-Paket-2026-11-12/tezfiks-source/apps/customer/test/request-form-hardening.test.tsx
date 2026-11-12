import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import { act } from '@testing-library/react-native';
import path from 'node:path';
import { IDS, assignment, detail } from './fixtures';
import { fail, flush, ok, on, resetApp, signedInCustomer } from './screen-helpers';

const APP_DIR = path.join(__dirname, '..', 'src', 'app');
const GEO = { lat: 40.4093, lng: 49.8671, formatted: 'Atatürk pr. 45, Bakı', placeId: null, district: 'Nərimanov', street: 'Atatürk pr.', building: '45', source: 'fallback' };

async function openFilledForm() {
  const r = await renderRouter(APP_DIR, { initialUrl: `/request/new?categoryId=${IDS.plumbing}` });
  await waitFor(() => expect(screen.getByTestId('create-request-screen')).toBeTruthy());
  await waitFor(() => expect(screen.getByTestId('request-address-text').props.children).toBe('Atatürk pr. 45, Bakı'));
  await fireEvent.changeText(screen.getByTestId('request-description'), 'Kran damcılayır');
  return r;
}

describe('create request: idempotency and error handling', () => {
  beforeEach(() => resetApp());

  it('a real network failure (fetch rejects) keeps the idempotency key for the retry', async () => {
    let attempts = 0;
    const api = signedInCustomer({
      extra: [
        on('GET', '/geo/reverse', () => ok(GEO)),
        on('POST', '/requests', () => {
          attempts += 1;
          if (attempts === 1) throw new TypeError('Network request failed');
          return ok(detail());
        }),
        on('GET', '/requests/:id', () => ok(detail())),
      ],
    });
    await openFilledForm();
    await fireEvent.press(screen.getByTestId('request-submit'));
    await waitFor(() => expect(screen.getByTestId('request-form-error')).toBeTruthy());
    expect(screen.getAllByText('Serverə qoşulmaq mümkün olmadı').length).toBeGreaterThan(0);
    await fireEvent.press(screen.getByTestId('request-submit'));
    await waitFor(() => expect(screen.getByTestId('searching-screen')).toBeTruthy());
    const [a, b] = api.find('POST', '/requests');
    expect(a.headers['Idempotency-Key']).toBeTruthy();
    expect(a.headers['Idempotency-Key']).toBe(b.headers['Idempotency-Key']);
  });

  it('a double tap on "Usta çağır" sends one request', async () => {
    const api = signedInCustomer({
      extra: [on('GET', '/geo/reverse', () => ok(GEO)), on('POST', '/requests', () => ok(detail())), on('GET', '/requests/:id', () => ok(detail()))],
    });
    await openFilledForm();
    // Hold the POST until both taps happened.
    const realFetch = global.fetch;
    let release: () => void = () => undefined;
    let submits = 0;
    const gate = new Promise<void>((res) => (release = res));
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(init?.method) === 'POST' && String(input).endsWith('/requests')) {
        submits += 1;
        await gate;
      }
      return realFetch(input, init);
    }) as unknown as typeof fetch;
    // Two taps in the same frame, before React re-renders the button as loading (host Pressable click handler).
    const host = screen.getByTestId('request-submit') as unknown as { props: { onClick: (e: unknown) => void } };
    const tap = () => host.props.onClick({ nativeEvent: {}, persist: () => undefined, stopPropagation: () => undefined });
    await act(async () => {
      tap();
      tap();
    });
    expect(submits).toBe(1);
    await flush(10);
    release();
    await waitFor(() => expect(screen.getByTestId('searching-screen')).toBeTruthy());
    expect(api.find('POST', '/requests')).toHaveLength(1);
  });

  it('CONFLICT REQUEST_IN_PROGRESS keeps the key and says the order is still being sent', async () => {
    let attempts = 0;
    const api = signedInCustomer({
      extra: [
        on('GET', '/geo/reverse', () => ok(GEO)),
        on('POST', '/requests', () => {
          attempts += 1;
          return attempts === 1 ? fail(409, 'CONFLICT', { reason: 'REQUEST_IN_PROGRESS' }) : ok(detail());
        }),
        on('GET', '/requests/:id', () => ok(detail())),
      ],
    });
    await openFilledForm();
    await fireEvent.press(screen.getByTestId('request-submit'));
    await waitFor(() => expect(screen.getByTestId('request-form-error')).toBeTruthy());
    expect(screen.getAllByText('Sifarişiniz artıq göndərilir, bir az gözləyin').length).toBeGreaterThan(0);
    await fireEvent.press(screen.getByTestId('request-submit'));
    await waitFor(() => expect(screen.getByTestId('searching-screen')).toBeTruthy());
    const [a, b] = api.find('POST', '/requests');
    expect(a.headers['Idempotency-Key']).toBe(b.headers['Idempotency-Key']);
  });

  it.each([
    ['USER_BLOCKED', 403, 'Hesabınız bloklanıb'],
    ['NOT_ELIGIBLE', 403, null],
    ['PROFILE_INCOMPLETE', 409, null],
    ['IDEMPOTENCY_CONFLICT', 409, null],
  ])('%s from POST /requests shows its own localized message, not the generic one', async (code, status, expected) => {
    const common = require('../../../packages/i18n/locales/az/common.json') as { errors: Record<string, string> };
    const message = expected ?? common.errors[code];
    expect(common.errors[code]).toBeTruthy();
    if (expected) expect(common.errors[code]).toContain(expected);
    signedInCustomer({ extra: [on('GET', '/geo/reverse', () => ok(GEO)), on('POST', '/requests', () => fail(status, code))] });
    await openFilledForm();
    await fireEvent.press(screen.getByTestId('request-submit'));
    await waitFor(() => expect(screen.getAllByText(new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).length).toBeGreaterThan(0));
    expect(screen.queryByText(common.errors.INTERNAL)).toBeNull();
  });

  it('saving an address to the book requires a name', async () => {
    const api = signedInCustomer({
      extra: [on('GET', '/geo/reverse', () => ok(GEO)), on('POST', '/requests', () => ok(detail())), on('GET', '/requests/:id', () => ok(detail()))],
    });
    await openFilledForm();
    await fireEvent.press(screen.getByTestId('request-address'));
    await waitFor(() => expect(screen.getByTestId('address-picker')).toBeTruthy());
    await fireEvent(screen.getByTestId('address-save-toggle'), 'valueChange', true);
    await fireEvent.press(screen.getByTestId('address-confirm'));
    expect(screen.getByTestId('address-error').props.children).toBe('Ünvanı yadda saxlamaq üçün ona ad verin (məsələn: Ev)');
    expect(screen.getByTestId('address-picker')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('address-label'), '  Ofis ');
    await fireEvent.press(screen.getByTestId('address-confirm'));
    await fireEvent.press(screen.getByTestId('request-submit'));
    await waitFor(() => expect(api.find('POST', '/requests')).toHaveLength(1));
    expect(api.find('POST', '/requests')[0].body).toMatchObject({ saveAddressLabel: 'Ofis' });
  });
});

describe('request detail privacy', () => {
  beforeEach(() => resetApp());

  it('a provider phone is never shown on the detail before the contact is unlocked', async () => {
    const leaked = assignment({ contactUnlocked: false, providerPhone: '+994501234567' });
    signedInCustomer({
      extra: [
        on('GET', '/requests/:id', () =>
          ok(detail({ status: 'ASSIGNED', isSearching: false, slotsFilled: 1, search: null, slots: [{ index: 0, status: 'FILLED', assignmentId: IDS.assignment }], assignments: [leaked] })),
        ),
      ],
    });
    await renderRouter(APP_DIR, { initialUrl: `/request/${IDS.request}` });
    await waitFor(() => expect(screen.getByTestId(`detail-assignment-${IDS.assignment}`)).toBeTruthy());
    expect(within(screen.getByTestId('detail-slot-0')).getByText('Elvin Məmmədov')).toBeTruthy();
    expect(screen.queryByText(/\+994/)).toBeNull();
    expect(screen.queryByText(/501234567/)).toBeNull();
  });
});

describe('find by photo: catalogue not loaded yet', () => {
  beforeEach(() => resetApp());

  it('a confident classification still opens the form when the categories failed to load before', async () => {
    const picker = require('expo-image-picker') as { launchImageLibraryAsync: jest.Mock };
    picker.launchImageLibraryAsync.mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file:///p.jpg', mimeType: 'image/jpeg', fileName: 'p.jpg', width: 800, height: 600 }] });
    let catalogueUp = false;
    const { categories } = require('./fixtures') as typeof import('./fixtures');
    signedInCustomer({
      extra: [
        on('GET', '/categories', () => (catalogueUp ? ok({ items: categories() }) : fail(400, 'VALIDATION_FAILED'))),
        on('POST', '/files', () => ok({ id: IDS.file, kind: 'REQUEST_PHOTO', url: 'http://x/f', contentType: 'image/jpeg', width: 800, height: 600 })),
        on('POST', '/requests/classify-photo', () => {
          catalogueUp = true;
          return ok({ status: 'ok', categoryId: IDS.plumbing, slug: 'plumbing', confidence: 'high', candidates: [] });
        }),
      ],
    });
    const r = await renderRouter(APP_DIR, { initialUrl: '/find-by-photo?vertical=HOME' });
    await waitFor(() => expect(screen.getByTestId('find-by-photo-screen')).toBeTruthy());
    await flush(10);
    await fireEvent.press(screen.getByTestId('find-by-photo-gallery'));
    await waitFor(() => expect(screen.getByTestId('create-request-screen')).toBeTruthy());
    expect(r.getSearchParams()).toMatchObject({ categoryId: IDS.plumbing, photoId: IDS.file });
  });
});
