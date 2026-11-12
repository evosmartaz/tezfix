import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import path from 'node:path';
import { IDS } from './fixtures';
import { fail, ok, on, resetApp, signedInCustomer } from './screen-helpers';

const APP_DIR = path.join(__dirname, '..', 'src', 'app');
const FILE_REF = { id: IDS.file, kind: 'REQUEST_PHOTO', url: 'http://10.0.2.2:3000/tezfix/api/files/x?exp=1&sig=s', contentType: 'image/jpeg', width: 1600, height: 1200 };

function galleryReturns(uri = 'file:///photos/leak.heic') {
  const picker = require('expo-image-picker') as { launchImageLibraryAsync: jest.Mock };
  picker.launchImageLibraryAsync.mockResolvedValueOnce({ canceled: false, assets: [{ uri, mimeType: 'image/heic', fileName: 'leak.heic', width: 4032, height: 3024 }] });
}

describe('find by photo ("Şəkil ilə tap")', () => {
  beforeEach(() => resetApp());

  it('a confident AI pick opens the request form with the service and the uploaded photo', async () => {
    galleryReturns();
    const api = signedInCustomer({
      extra: [
        on('POST', '/files', () => ok(FILE_REF)),
        on('POST', '/requests/classify-photo', () => ok({ status: 'ok', categoryId: IDS.plumbing, slug: 'plumbing', confidence: 'high', candidates: [] })),
      ],
    });
    const r = await renderRouter(APP_DIR, { initialUrl: '/find-by-photo?vertical=HOME' });
    await waitFor(() => expect(screen.getByTestId('find-by-photo-screen')).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('find-by-photo-note'), 'Kran damcılayır');
    await fireEvent.press(screen.getByTestId('find-by-photo-gallery'));
    await waitFor(() => expect(screen.getByTestId('create-request-screen')).toBeTruthy());
    expect(r.getPathname()).toBe('/request/new');
    expect(r.getSearchParams()).toMatchObject({ categoryId: IDS.plumbing, photoId: IDS.file });

    const upload = api.find('POST', '/files')[0];
    expect(upload.formData?.getAll('kind')).toEqual(['REQUEST_PHOTO']);
    expect(api.find('POST', '/requests/classify-photo')[0].body).toEqual({ fileId: IDS.file, vertical: 'HOME', note: 'Kran damcılayır' });
    // The note becomes the description and the photo is already attached.
    await waitFor(() => expect(screen.getByTestId('request-description').props.value).toBe('Kran damcılayır'));
    expect(screen.getByTestId('photo-picker')).toBeTruthy();
    expect(screen.getByText('1 / 5 şəkil')).toBeTruthy();
  });

  it('an unsure result shows the candidates first, then the full picker', async () => {
    galleryReturns();
    signedInCustomer({
      extra: [
        on('POST', '/files', () => ok(FILE_REF)),
        on('POST', '/requests/classify-photo', () =>
          ok({
            status: 'unsure',
            categoryId: null,
            slug: null,
            confidence: 'low',
            candidates: [
              { categoryId: IDS.heating, slug: 'heating', name: 'Kombi / istilik' },
              { categoryId: IDS.plumbing, slug: 'plumbing', name: 'Santexnik' },
            ],
          }),
        ),
      ],
    });
    const r = await renderRouter(APP_DIR, { initialUrl: '/find-by-photo' });
    await waitFor(() => expect(screen.getByTestId('find-by-photo-screen')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('find-by-photo-gallery'));
    await waitFor(() => expect(screen.getByTestId('find-by-photo-choose')).toBeTruthy());
    expect(screen.getByText('Xidməti dəqiq müəyyən edə bilmədik. Aşağıdakılardan birini seçin')).toBeTruthy();
    expect(screen.getByTestId('category-suggestions')).toBeTruthy();
    expect(screen.getAllByTestId('category-tile-heating').length).toBeGreaterThan(0);
    await fireEvent.press(screen.getAllByTestId('category-tile-heating')[0]);
    await waitFor(() => expect(screen.getByTestId('create-request-screen')).toBeTruthy());
    expect(r.getSearchParams()).toMatchObject({ categoryId: IDS.heating, photoId: IDS.file });
  });

  it('AI unavailable or rate limited falls back to the manual picker with a message', async () => {
    galleryReturns();
    signedInCustomer({ extra: [on('POST', '/files', () => ok(FILE_REF)), on('POST', '/requests/classify-photo', () => fail(429, 'RATE_LIMITED'))] });
    await renderRouter(APP_DIR, { initialUrl: '/find-by-photo' });
    await waitFor(() => expect(screen.getByTestId('find-by-photo-screen')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('find-by-photo-gallery'));
    await waitFor(() => expect(screen.getByTestId('find-by-photo-choose')).toBeTruthy());
    expect(screen.getByText('Çox sayda cəhd. Bir az sonra yenidən yoxlayın')).toBeTruthy();
    expect(screen.getByTestId('category-browser')).toBeTruthy();
  });

  it('camera permission denied keeps the user on the pick step', async () => {
    const api = signedInCustomer();
    await renderRouter(APP_DIR, { initialUrl: '/find-by-photo' });
    await waitFor(() => expect(screen.getByTestId('find-by-photo-screen')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('find-by-photo-camera'));
    await waitFor(() => expect(screen.getByText('Kameraya icazə verilmədi')).toBeTruthy());
    expect(screen.getByTestId('find-by-photo-pick')).toBeTruthy();
    expect(api.find('POST', '/files')).toHaveLength(0);
  });

  it('a failed upload shows the error and allows another try', async () => {
    galleryReturns();
    signedInCustomer({ extra: [on('POST', '/files', () => fail(413, 'FILE_TOO_LARGE'))] });
    await renderRouter(APP_DIR, { initialUrl: '/find-by-photo' });
    await waitFor(() => expect(screen.getByTestId('find-by-photo-screen')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('find-by-photo-gallery'));
    await waitFor(() => expect(screen.getByText('Fayl çox böyükdür')).toBeTruthy());
    expect(screen.getByTestId('find-by-photo-pick')).toBeTruthy();
  });
});
