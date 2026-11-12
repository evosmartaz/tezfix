import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { act } from '@testing-library/react-native';
import path from 'node:path';
import { IDS, account, detail } from './fixtures';
import { fail, flush, ok, on, resetApp, signedInCustomer } from './screen-helpers';

const APP_DIR = path.join(__dirname, '..', 'src', 'app');
const GEO = { lat: 40.4093, lng: 49.8671, formatted: 'Atatürk pr. 45, Bakı', placeId: null, district: 'Nərimanov', street: 'Atatürk pr.', building: '45', source: 'fallback' };

async function openForm(categoryId: string = IDS.plumbing) {
  const r = await renderRouter(APP_DIR, { initialUrl: `/request/new?categoryId=${categoryId}` });
  await waitFor(() => expect(screen.getByTestId('create-request-screen')).toBeTruthy());
  return r;
}

describe('create request (board 02 B3)', () => {
  beforeEach(() => resetApp());

  it('pins the current location, validates, posts the contract body and opens the searching screen', async () => {
    const api = signedInCustomer({
      extra: [
        on('GET', '/geo/reverse', () => ok(GEO)),
        on('POST', '/requests', (c) => ok(detail({ description: (c.body as { description: string }).description }))),
        on('GET', '/requests/:id', () => ok(detail())),
      ],
    });
    const r = await openForm();
    await waitFor(() => expect(screen.getByTestId('request-address-text').props.children).toBe('Atatürk pr. 45, Bakı'));
    expect(screen.getAllByText('Santexnik').length).toBeGreaterThan(0);
    // Plumbing allows emergencies: all three timings.
    expect(screen.getByTestId('request-timing-EMERGENCY')).toBeTruthy();
    // Individual customers cannot choose the provider type.
    expect(screen.queryByTestId('request-preference')).toBeNull();

    await fireEvent.press(screen.getByTestId('request-submit'));
    // Inline under the field and as a toast.
    expect(screen.getAllByText('Problemi qısaca təsvir edin (ən azı 3 simvol)').length).toBeGreaterThan(0);
    expect(api.find('POST', '/requests')).toHaveLength(0);

    await fireEvent.changeText(screen.getByTestId('request-description'), '  Mətbəxdə kran damcılayır ');
    await fireEvent.press(screen.getByTestId('request-slots-inc'));
    expect(screen.getByTestId('request-slots-value').props.children).toBe('2 usta');
    await fireEvent.press(screen.getByTestId('request-submit'));
    await waitFor(() => expect(screen.getByTestId('searching-screen')).toBeTruthy());
    expect(r.getPathname()).toBe(`/request/${IDS.request}/searching`);

    const post = api.find('POST', '/requests')[0];
    expect(post.body).toEqual({
      categoryId: IDS.plumbing,
      description: 'Mətbəxdə kran damcılayır',
      photoFileIds: [],
      timing: 'NOW',
      slots: 2,
      providerPreference: 'ANY',
      address: { lat: 40.4093, lng: 49.8671, formatted: 'Atatürk pr. 45, Bakı', district: 'Nərimanov', street: 'Atatürk pr.', building: '45' },
    });
    expect(post.headers['Idempotency-Key']).toBeTruthy();
  });

  it('emergency shows 5 AZN per handyman and blocks submit with a top-up action when the wallet is short', async () => {
    const api = signedInCustomer({
      account: account({ wallet: { accountId: IDS.wallet, currency: 'AZN', posted: 700, held: 0, available: 700, isDebt: false, lowBalance: true } }),
      extra: [on('GET', '/geo/reverse', () => ok(GEO))],
    });
    const r = await openForm();
    await waitFor(() => expect(screen.getByTestId('request-address-text').props.children).toBe('Atatürk pr. 45, Bakı'));
    await fireEvent.changeText(screen.getByTestId('request-description'), 'Su axır, təcili lazımdır');
    await fireEvent.press(screen.getByTestId('request-timing-EMERGENCY'));
    await fireEvent.press(screen.getByTestId('request-slots-inc'));
    // Copy change (same amounts): the text says the fee is held, not charged, and refunded when no handyman is found.
    expect(screen.getByText('Təcili çağırış: hər usta üçün +5 ₼, cəmi 10 ₼. Məbləğ balansınızda bloklanır, usta tapılmasa geri qaytarılır.')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('request-emergency-shortfall')).toBeTruthy());
    expect(screen.getByText('Balans kifayət etmir, 3,00 ₼ çatmır')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('request-submit'));
    expect(screen.getByTestId('error-timing')).toBeTruthy();
    expect(api.find('POST', '/requests')).toHaveLength(0);

    await fireEvent.press(screen.getByTestId('request-topup'));
    await waitFor(() => expect(r.getPathname()).toBe('/wallet'));
  });

  it('Təcili is not offered for services that do not allow it', async () => {
    signedInCustomer();
    await openForm(IDS.painting);
    expect(screen.getByTestId('request-timing-NOW')).toBeTruthy();
    expect(screen.getByTestId('request-timing-SCHEDULED')).toBeTruthy();
    expect(screen.queryByTestId('request-timing-EMERGENCY')).toBeNull();
  });

  it('Planla sends a Baku-time scheduledAt picked with the native dialogs', async () => {
    const { DateTimePickerAndroid } = require('@react-native-community/datetimepicker') as { DateTimePickerAndroid: { open: jest.Mock } };
    const api = signedInCustomer({
      extra: [
        on('GET', '/geo/reverse', () => ok(GEO)),
        on('POST', '/requests', () => ok(detail({ timing: 'SCHEDULED', scheduledAt: '2099-01-01T08:30:00.000Z' }))),
        on('GET', '/requests/:id', () => ok(detail({ timing: 'SCHEDULED', scheduledAt: '2099-01-01T08:30:00.000Z' }))),
      ],
    });
    const r = await openForm();
    await waitFor(() => expect(screen.getByTestId('request-address-text').props.children).toBe('Atatürk pr. 45, Bakı'));
    await fireEvent.changeText(screen.getByTestId('request-description'), 'Kondisioner quraşdırmaq');
    await fireEvent.press(screen.getByTestId('request-timing-SCHEDULED'));
    expect(screen.getByTestId('scheduled-picker')).toBeTruthy();
    expect(screen.getByText('Vaxt Bakı vaxtı ilə göstərilir')).toBeTruthy();

    // Choose tomorrow's date, then 12:30 Baku time.
    await fireEvent.press(screen.getByTestId('scheduled-date'));
    const dateArgs = DateTimePickerAndroid.open.mock.calls.at(-1)[0];
    expect(dateArgs).toMatchObject({ mode: 'date', timeZoneName: 'Asia/Baku' });
    const tomorrow = new Date(Date.now() + 86_400_000);
    await act(async () => dateArgs.onChange({ type: 'set', nativeEvent: { timestamp: tomorrow.getTime(), utcOffset: 240 } }, tomorrow));
    await fireEvent.press(screen.getByTestId('scheduled-time'));
    const timeArgs = DateTimePickerAndroid.open.mock.calls.at(-1)[0];
    expect(timeArgs).toMatchObject({ mode: 'time', is24Hour: true, timeZoneName: 'Asia/Baku' });
    const at1230 = new Date('2026-01-01T08:30:00.000Z'); // 12:30 in Baku
    await act(async () => timeArgs.onChange({ type: 'set', nativeEvent: { timestamp: at1230.getTime(), utcOffset: 240 } }, at1230));
    await waitFor(() => expect(screen.getByText('12:30')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('request-submit'));
    await waitFor(() => expect(api.find('POST', '/requests')).toHaveLength(1));
    const body = api.find('POST', '/requests')[0].body as { timing: string; scheduledAt: string };
    expect(body.timing).toBe('SCHEDULED');
    const sent = new Date(body.scheduledAt);
    expect(sent.getUTCHours()).toBe(8);
    expect(sent.getUTCMinutes()).toBe(30);
    // Scheduled requests open the detail, not the live searching screen.
    await waitFor(() => expect(r.getPathname()).toBe(`/request/${IDS.request}`));
  });

  it('company accounts choose the provider type', async () => {
    const api = signedInCustomer({
      customerType: 'COMPANY',
      extra: [on('GET', '/geo/reverse', () => ok(GEO)), on('POST', '/requests', () => ok(detail({ status: 'ASSIGNED', isSearching: false }))), on('GET', '/requests/:id', () => ok(detail()))],
    });
    await openForm();
    await waitFor(() => expect(screen.getByTestId('request-preference')).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId('request-address-text').props.children).toBe('Atatürk pr. 45, Bakı'));
    await fireEvent.press(screen.getByTestId('request-preference-switch-COMPANY'));
    await fireEvent.changeText(screen.getByTestId('request-description'), 'Ofisdə 3 rozetka');
    await fireEvent.press(screen.getByTestId('request-submit'));
    await waitFor(() => expect(api.find('POST', '/requests')).toHaveLength(1));
    expect(api.find('POST', '/requests')[0].body).toMatchObject({ providerPreference: 'COMPANY' });
  });

  it('CUSTOMER_IN_DEBT from the API shows the localized message and a top-up action', async () => {
    const api = signedInCustomer({ extra: [on('GET', '/geo/reverse', () => ok(GEO)), on('POST', '/requests', () => fail(409, 'CUSTOMER_IN_DEBT'))] });
    const r = await openForm();
    await waitFor(() => expect(screen.getByTestId('request-address-text').props.children).toBe('Atatürk pr. 45, Bakı'));
    await fireEvent.changeText(screen.getByTestId('request-description'), 'Kran damcılayır');
    await fireEvent.press(screen.getByTestId('request-submit'));
    await waitFor(() => expect(screen.getByTestId('request-form-error')).toBeTruthy());
    expect(screen.getAllByText('Balansınızda borc var. Yeni sifariş üçün balansı artırın').length).toBeGreaterThan(0);
    expect(r.getPathname()).toBe('/request/new');
    // A second attempt after a business error uses a new idempotency key.
    await fireEvent.press(screen.getByTestId('request-submit'));
    await waitFor(() => expect(api.find('POST', '/requests')).toHaveLength(2));
    const [a, b] = api.find('POST', '/requests');
    expect(a.headers['Idempotency-Key']).not.toBe(b.headers['Idempotency-Key']);
    await fireEvent.press(screen.getByTestId('request-error-topup'));
    await waitFor(() => expect(r.getPathname()).toBe('/wallet'));
  });

  it('a network failure keeps the idempotency key so a retry cannot create a second request', async () => {
    let attempts = 0;
    const api = signedInCustomer({
      extra: [
        on('GET', '/geo/reverse', () => ok(GEO)),
        on('POST', '/requests', () => {
          attempts += 1;
          return attempts === 1 ? fail(500, 'INTERNAL') : ok(detail());
        }),
        on('GET', '/requests/:id', () => ok(detail())),
      ],
    });
    await openForm();
    await waitFor(() => expect(screen.getByTestId('request-address-text').props.children).toBe('Atatürk pr. 45, Bakı'));
    await fireEvent.changeText(screen.getByTestId('request-description'), 'Kran damcılayır');
    await fireEvent.press(screen.getByTestId('request-submit'));
    await waitFor(() => expect(screen.getByTestId('request-form-error')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('request-submit'));
    await waitFor(() => expect(screen.getByTestId('searching-screen')).toBeTruthy());
    const [a, b] = api.find('POST', '/requests');
    expect(a.headers['Idempotency-Key']).toBe(b.headers['Idempotency-Key']);
  });

  it('without location permission the customer picks the address on the map, with structured fields and address book', async () => {
    const Location = require('expo-location') as { requestForegroundPermissionsAsync: jest.Mock };
    Location.requestForegroundPermissionsAsync.mockResolvedValueOnce({ granted: false, status: 'denied', canAskAgain: true });
    const api = signedInCustomer({
      extra: [
        on('GET', '/geo/reverse', (c) => ok({ ...GEO, lat: Number(c.query.lat), lng: Number(c.query.lng), formatted: 'Şəhriyar küç. 7, Xətai', district: 'Xətai', street: 'Şəhriyar küç.', building: '7' })),
        on('POST', '/requests', () => ok(detail())),
        on('GET', '/requests/:id', () => ok(detail())),
      ],
    });
    await openForm();
    await flush(10);
    expect(screen.getByTestId('request-address-text').props.children).toBe('Ünvanı seçin');
    await fireEvent.changeText(screen.getByTestId('request-description'), 'Kran damcılayır');
    await fireEvent.press(screen.getByTestId('request-submit'));
    expect(screen.getByTestId('error-address')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('request-address'));
    await waitFor(() => expect(screen.getByTestId('address-picker')).toBeTruthy());
    await fireEvent(screen.getByTestId('tf-map'), 'regionChangeComplete', { latitude: 40.3801, longitude: 49.9002, latitudeDelta: 0.01, longitudeDelta: 0.01 });
    await waitFor(() => expect(screen.getByTestId('address-formatted').props.value).toBe('Şəhriyar küç. 7, Xətai'), { timeout: 3000 });
    await fireEvent.changeText(screen.getByTestId('address-apartment'), '12');
    await fireEvent.changeText(screen.getByTestId('address-entrance'), '3');
    await fireEvent(screen.getByTestId('address-save-toggle'), 'valueChange', true);
    await fireEvent.changeText(screen.getByTestId('address-label'), 'Ev');
    await fireEvent.press(screen.getByTestId('address-confirm'));
    await waitFor(() => expect(screen.getByTestId('request-address-text').props.children).toBe('Şəhriyar küç. 7, Xətai'));
    expect(screen.getByText('giriş 3, mənzil 12')).toBeTruthy();

    // Reopening the picker: the map reports its initial region (the current pin); that must not re-geocode and
    // overwrite the confirmed fields.
    const reverseCalls = api.find('GET', '/geo/reverse').length;
    await fireEvent.press(screen.getByTestId('request-address'));
    await waitFor(() => expect(screen.getByTestId('address-picker')).toBeTruthy());
    await fireEvent(screen.getByTestId('tf-map'), 'regionChangeComplete', { latitude: 40.380100000001, longitude: 49.9002, latitudeDelta: 0.01, longitudeDelta: 0.01 });
    await flush(1000);
    expect(api.find('GET', '/geo/reverse')).toHaveLength(reverseCalls);
    expect(screen.getByTestId('address-apartment').props.value).toBe('12');
    await fireEvent.press(screen.getByTestId('address-confirm'));

    await fireEvent.press(screen.getByTestId('request-submit'));
    await waitFor(() => expect(api.find('POST', '/requests')).toHaveLength(1));
    expect(api.find('POST', '/requests')[0].body).toMatchObject({
      address: { lat: 40.3801, lng: 49.9002, formatted: 'Şəhriyar küç. 7, Xətai', district: 'Xətai', street: 'Şəhriyar küç.', building: '7', entrance: '3', apartment: '12' },
      saveAddressLabel: 'Ev',
    });
  });

  it('photos are resized, uploaded as REQUEST_PHOTO and sent as file ids; a failed upload can be retried or removed', async () => {
    const picker = require('expo-image-picker') as { launchImageLibraryAsync: jest.Mock };
    picker.launchImageLibraryAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [
        { uri: 'file:///a.jpg', mimeType: 'image/jpeg', fileName: 'a.jpg', width: 4000, height: 3000 },
        { uri: 'file:///b.jpg', mimeType: 'image/jpeg', fileName: 'b.jpg', width: 800, height: 600 },
      ],
    });
    let uploads = 0;
    const api = signedInCustomer({
      extra: [
        on('GET', '/geo/reverse', () => ok(GEO)),
        on('POST', '/files', () => {
          uploads += 1;
          if (uploads === 2) return fail(413, 'FILE_TOO_LARGE');
          return ok({ id: `00000000-0000-4000-a000-00000000f00${uploads}`, kind: 'REQUEST_PHOTO', url: 'http://x/f', contentType: 'image/jpeg', width: 1600, height: 1200 });
        }),
        on('POST', '/requests', () => ok(detail())),
        on('GET', '/requests/:id', () => ok(detail())),
      ],
    });
    await openForm();
    await waitFor(() => expect(screen.getByTestId('request-address-text').props.children).toBe('Atatürk pr. 45, Bakı'));
    await fireEvent.press(screen.getByTestId('photo-add'));
    await fireEvent.press(screen.getByTestId('photo-source-gallery'));
    await waitFor(() => expect(api.find('POST', '/files')).toHaveLength(2));
    await waitFor(() => expect(screen.getAllByTestId(/^photo-p\d+-error$/)).toHaveLength(1));
    expect(picker.launchImageLibraryAsync).toHaveBeenLastCalledWith(expect.objectContaining({ allowsMultipleSelection: true, selectionLimit: 5 }));
    for (const call of api.find('POST', '/files')) expect(call.formData?.getAll('kind')).toEqual(['REQUEST_PHOTO']);
    // The big photo was downscaled before upload (expo-image-manipulator, longest side 1600 px).
    const manip = require('expo-image-manipulator') as { ImageManipulator: { manipulate: jest.Mock } };
    expect(manip.ImageManipulator.manipulate).toHaveBeenCalledWith('file:///a.jpg');

    // Retry the failed one.
    await fireEvent.press(screen.getAllByTestId(/^photo-p\d+-error$/)[0]);
    await waitFor(() => expect(api.find('POST', '/files')).toHaveLength(3));
    await waitFor(() => expect(screen.queryAllByTestId(/^photo-p\d+-(error|uploading)$/)).toHaveLength(0));
    expect(screen.getByText('2 / 5 şəkil')).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId('request-description'), 'Kran damcılayır');
    await fireEvent.press(screen.getByTestId('request-submit'));
    await waitFor(() => expect(api.find('POST', '/requests')).toHaveLength(1));
    expect((api.find('POST', '/requests')[0].body as { photoFileIds: string[] }).photoFileIds).toEqual([
      '00000000-0000-4000-a000-00000000f001',
      '00000000-0000-4000-a000-00000000f003',
    ]);
  });

  it('quote-only services cannot be ordered instantly', async () => {
    signedInCustomer();
    await openForm(IDS.brigade);
    await waitFor(() => expect(screen.getByTestId('request-quote-only')).toBeTruthy());
    expect(screen.getByTestId('request-submit')).toBeDisabled();
  });
});
