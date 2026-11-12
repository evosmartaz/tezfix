import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import path from 'node:path';
import type { ProjectDetail } from '@tezfiks/shared';
import { IDS } from './fixtures';
import { M3, companyQuote, invoice, project, projectSummary, quote, report } from './fixtures-m3';
import { secureStore } from './helpers';
import { fail, ok, on, resetApp, serverEmit, signedInCustomer, type Handler } from './screen-helpers';
import { nb } from './text';

const APP_DIR = path.join(__dirname, '..', 'src', 'app');
const GEO = { lat: 40.4093, lng: 49.8671, formatted: 'Nizami küç. 203, Bakı', placeId: null, district: 'Səbail', street: 'Nizami küç.', building: '203' };
const datePicker = () => (require('@react-native-community/datetimepicker') as { DateTimePickerAndroid: { open: jest.Mock } }).DateTimePickerAndroid.open;

/** Answers the next native date dialog with a Baku noon of `day`. */
function pickDay(day: string) {
  datePicker().mockImplementationOnce((opts: { onChange: (e: { type: string }, d?: Date) => void }) => opts.onChange({ type: 'set' }, new Date(`${day}T08:00:00.000Z`)));
}

function setup(p: ProjectDetail = project(), extra: Handler[] = [], customerType: 'INDIVIDUAL' | 'COMPANY' = 'COMPANY') {
  const state = { p };
  const api = signedInCustomer({
    customerType,
    extra: [
      ...extra,
      on('GET', '/geo/reverse', () => ok(GEO)),
      on('GET', '/projects/:id', () => ok(state.p)),
      on('GET', '/projects', (c) => ok({ items: c.query.scope === 'history' ? [] : [projectSummary()], nextCursor: null })),
    ],
  });
  return { api, state };
}

describe('business order form (board 02 D)', () => {
  beforeEach(() => {
    resetApp();
    datePicker().mockReset();
  });

  it('a quote-only service in the request form leads to the business form with the text kept', async () => {
    setup();
    const r = await renderRouter(APP_DIR, { initialUrl: `/request/new?categoryId=${IDS.brigade}` });
    await waitFor(() => expect(screen.getByTestId('request-quote-only')).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('request-description'), 'Ofis təmiri');
    await fireEvent.press(screen.getByTestId('request-business'));
    await waitFor(() => expect(screen.getByTestId('project-new-screen')).toBeTruthy());
    expect(r.getPathname()).toBe('/project/new');
    expect(screen.getByText('Tikinti-təmir briqadası')).toBeTruthy();
    expect(screen.getByTestId('project-description').props.value).toBe('Ofis təmiri');
  });

  it('quote-only tiles in all categories open the business form directly', async () => {
    setup(project(), [], 'INDIVIDUAL');
    const r = await renderRouter(APP_DIR, { initialUrl: '/categories' });
    await waitFor(() => expect(screen.getByTestId('categories-screen')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('Tikinti-təmir briqadası')).toBeTruthy());
    await fireEvent.press(screen.getByText('Tikinti-təmir briqadası'));
    await waitFor(() => expect(r.getPathname()).toBe('/project/new'));
  });

  it('company accounts see the "Biznes sifarişi" entry on home', async () => {
    setup();
    const r = await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(screen.getByTestId('home-business')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('home-business'));
    await waitFor(() => expect(r.getPathname()).toBe('/project/new'));
    expect(screen.getByTestId('project-company')).toBeTruthy();
    expect(screen.getByText('Kontur MMC')).toBeTruthy();
  });

  it('individual accounts do not see the home business entry', async () => {
    setup(project(), [], 'INDIVIDUAL');
    await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(screen.getByTestId('home-find-by-photo')).toBeTruthy());
    expect(screen.queryByTestId('home-business')).toBeNull();
  });

  it('validates, then sends one idempotent POST /projects and opens the project', async () => {
    const { api } = setup(project(), [on('POST', '/projects', () => ok(project()))]);
    const r = await renderRouter(APP_DIR, { initialUrl: `/project/new?categoryId=${IDS.brigade}` });
    await waitFor(() => expect(screen.getByTestId('project-address-text').props.children).toBe('Nizami küç. 203, Bakı'));
    await fireEvent.press(screen.getByTestId('project-submit'));
    expect(screen.getAllByText('İşin həcmini qeyd edin').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Tarix aralığını seçin').length).toBeGreaterThan(0);
    expect(api.find('POST', '/projects')).toHaveLength(0);

    await fireEvent.changeText(screen.getByTestId('project-scope'), '≈ 450 m² (3 mərtəbə, 12 otaq)');
    pickDay('2099-10-15');
    await fireEvent.press(screen.getByTestId('project-date-from'));
    pickDay('2099-10-19');
    await fireEvent.press(screen.getByTestId('project-date-to'));
    expect(screen.getByTestId('project-date-from-value').props.children).toBe('15.10.2099');
    expect(screen.getByText('5 iş günü')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('project-workers-inc'));
    await fireEvent.press(screen.getByTestId('project-workers-inc'));
    await fireEvent.changeText(screen.getByTestId('project-description'), 'Ofis divarlarının rənglənməsi');
    await fireEvent.press(screen.getByTestId('project-submit'));
    await waitFor(() => expect(r.getPathname()).toBe(`/project/${M3.project}`));
    const post = api.find('POST', '/projects')[0];
    expect(post.headers['Idempotency-Key']).toBeTruthy();
    expect(post.body).toMatchObject({
      categoryId: IDS.brigade,
      scope: '≈ 450 m² (3 mərtəbə, 12 otaq)',
      dateFrom: '2099-10-15',
      dateTo: '2099-10-19',
      workersNeeded: 3,
      description: 'Ofis divarlarının rənglənməsi',
      photoFileIds: [],
      address: { lat: 40.4093, lng: 49.8671, formatted: 'Nizami küç. 203, Bakı', district: 'Səbail', street: 'Nizami küç.', building: '203' },
    });
  });

  it('server errors are shown localized', async () => {
    setup(project(), [on('POST', '/projects', () => fail(409, 'CATEGORY_INACTIVE'))]);
    await renderRouter(APP_DIR, { initialUrl: `/project/new?categoryId=${IDS.brigade}` });
    await waitFor(() => expect(screen.getByTestId('project-address-text').props.children).toBe('Nizami küç. 203, Bakı'));
    await fireEvent.changeText(screen.getByTestId('project-scope'), '200 m²');
    pickDay('2099-10-15');
    await fireEvent.press(screen.getByTestId('project-date-from'));
    pickDay('2099-10-15');
    await fireEvent.press(screen.getByTestId('project-date-to'));
    await fireEvent.changeText(screen.getByTestId('project-description'), 'Dam örtüyü');
    await fireEvent.press(screen.getByTestId('project-submit'));
    await waitFor(() => expect(screen.getByTestId('project-form-error')).toBeTruthy());
  });
});

describe('project detail: compare and accept quotes, reports, invoice', () => {
  beforeEach(() => resetApp());

  it('lists quotes (cheapest first, badge, per worker-day) without any platform fee', async () => {
    setup();
    await renderRouter(APP_DIR, { initialUrl: `/project/${M3.project}` });
    await waitFor(() => expect(screen.getByTestId(`project-quote-${M3.quoteCompany}`)).toBeTruthy());
    expect(screen.getByTestId(`project-quote-${M3.quoteCompany}-cheapest`)).toBeTruthy();
    expect(screen.getByTestId(`project-quote-${M3.quoteCompany}-total`).props.children).toBe(nb('3.900,00 ₼'));
    expect(within(screen.getByTestId(`project-quote-${M3.quoteSolo}`)).getByText(/3 usta · 5 gün/)).toBeTruthy();
    expect(within(screen.getByTestId(`project-quote-${M3.quoteSolo}`)).getByText(/300,00 ₼ \/ usta-gün/)).toBeTruthy();
    expect(within(screen.getByTestId(`project-quote-${M3.quoteCompany}`)).getByText('ƏDV ödəyicisi')).toBeTruthy();
    expect(screen.queryByText(/haqq/i)).toBeNull();
    expect(screen.getByTestId('project-deadline')).toBeTruthy();
    // Sorting by rating puts the solo handyman (4.9) first.
    await fireEvent.press(screen.getByTestId('project-sort-rating'));
    const cards = screen.getAllByTestId(/^project-quote-[0-9a-f-]{36}$/).map((c) => c.props.testID);
    expect(cards).toEqual([`project-quote-${M3.quoteSolo}`, `project-quote-${M3.quoteCompany}`]);
  });

  it('accepting a quote asks for confirmation and sends one idempotent call', async () => {
    const { api, state } = setup(project(), [
      on('POST', '/projects/:id/quotes/:quoteId/accept', (_c, p) => {
        state.p = project({
          status: 'AWARDED',
          canCancel: false,
          awardedQuote: companyQuote({ status: 'ACCEPTED' }),
          quotes: [quote({ status: 'REJECTED' }), companyQuote({ status: 'ACCEPTED' })],
        });
        expect(p.quoteId).toBe(M3.quoteCompany);
        return ok(state.p);
      }),
    ]);
    await renderRouter(APP_DIR, { initialUrl: `/project/${M3.project}` });
    await waitFor(() => expect(screen.getByTestId(`project-quote-${M3.quoteCompany}-accept`)).toBeTruthy());
    await fireEvent.press(screen.getByTestId(`project-quote-${M3.quoteCompany}-accept`));
    expect(screen.getByText('FixPro MMC — 3.900,00 ₼. Şərtlər platformada qeydə alınacaq, digər təkliflər rədd ediləcək.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('project-accept-sheet-confirm'));
    await waitFor(() => expect(screen.getByTestId('project-awarded')).toBeTruthy());
    const calls = api.find('POST', `/projects/${M3.project}/quotes/${M3.quoteCompany}/accept`);
    expect(calls).toHaveLength(1);
    expect(calls[0].headers['Idempotency-Key']).toBeTruthy();
    expect(screen.queryByTestId(`project-quote-${M3.quoteSolo}-accept`)).toBeNull();
    expect(screen.getAllByText('İcraçı seçildi').length).toBeGreaterThan(0);
  });

  it('awarded project: daily reports with progress, then the invoice with VAT', async () => {
    const awarded = project({
      status: 'INVOICED',
      canCancel: false,
      awardedQuote: companyQuote({ status: 'ACCEPTED' }),
      quotes: [companyQuote({ status: 'ACCEPTED' })],
      reports: [report(), report({ id: 'r2', reportDate: '2099-10-18', progressPercent: 100, note: 'İş bitdi' })],
      invoice: invoice(),
    });
    setup(awarded);
    const r = await renderRouter(APP_DIR, { initialUrl: `/project/${M3.project}` });
    await waitFor(() => expect(screen.getByTestId('project-progress')).toBeTruthy());
    expect(screen.getByText('İcra: 100%')).toBeTruthy();
    expect(screen.getByText('İş bitdi')).toBeTruthy();
    expect(screen.getByTestId('project-rate')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('project-invoice'));
    await waitFor(() => expect(r.getPathname()).toBe(`/project/${M3.project}/invoice`));
    expect(screen.getByText('Hesab-faktura TF-2099-000001')).toBeTruthy();
    expect(screen.getByTestId('invoice-subtotal').props.children).toBe(nb('3.900,00 ₼'));
    expect(screen.getByTestId('invoice-vat').props.children).toBe(nb('702,00 ₼'));
    expect(screen.getByTestId('invoice-total').props.children).toBe(nb('4.602,00 ₼'));
    expect(screen.getByText('VÖEN: 1234567890')).toBeTruthy();
    expect(screen.getByTestId('invoice-pay-note')).toBeTruthy();
  });

  it('invoice of a non-VAT payer shows no VAT line', async () => {
    setup(project({ status: 'PAID', invoice: invoice({ issuer: { type: 'SOLO', name: 'Elvin Məmmədov', voen: null, isVatPayer: false }, vatRatePercent: 0, vatAmount: 0, total: 390000, status: 'PAID', paidAt: '2099-10-21T10:00:00.000Z' }) }));
    await renderRouter(APP_DIR, { initialUrl: `/project/${M3.project}/invoice` });
    await waitFor(() => expect(screen.getByTestId('invoice-no-vat')).toBeTruthy());
    expect(screen.queryByTestId('invoice-vat')).toBeNull();
    expect(screen.getByText('Ödənilib: 21.10.2099')).toBeTruthy();
  });

  it('cancelling an open request', async () => {
    const { api, state } = setup(project(), [
      on('POST', '/projects/:id/cancel', () => {
        state.p = project({ status: 'CANCELLED', canCancel: false, quotes: [quote({ status: 'REJECTED' }), companyQuote({ status: 'REJECTED' })] });
        return ok(state.p);
      }),
    ]);
    await renderRouter(APP_DIR, { initialUrl: `/project/${M3.project}` });
    await waitFor(() => expect(screen.getByTestId('project-cancel')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('project-cancel'));
    await fireEvent.press(screen.getByTestId('project-cancel-sheet-confirm'));
    await waitFor(() => expect(api.find('POST', `/projects/${M3.project}/cancel`)).toHaveLength(1));
    await waitFor(() => expect(screen.queryByTestId('project-cancel')).toBeNull());
  });

  it('a QUOTE_RECEIVED notification for this project refreshes it', async () => {
    const { state } = setup(project({ quotes: [] , quotesCount: 0 }));
    await renderRouter(APP_DIR, { initialUrl: `/project/${M3.project}` });
    await waitFor(() => expect(screen.getByTestId('project-no-quotes')).toBeTruthy());
    state.p = project({ quotes: [quote()], quotesCount: 1 });
    await serverEmit('notification:new', { id: M3.notification, type: 'QUOTE_RECEIVED', title: 'Yeni təklif', body: 'Elvin M.', data: { projectId: M3.project }, readAt: null, createdAt: '2099-10-13T12:00:00.000Z' });
    await waitFor(() => expect(screen.getByTestId(`project-quote-${M3.quoteSolo}`)).toBeTruthy());
  });

  it('project rating', async () => {
    const { api } = setup(project({ status: 'PAID', canCancel: false, awardedQuote: companyQuote({ status: 'ACCEPTED' }), guaranteeUntil: '2099-11-04T10:00:00.000Z' }), [
      on('POST', '/projects/:id/rating', () => ok({ ok: true })),
    ]);
    const r = await renderRouter(APP_DIR, { initialUrl: `/project/${M3.project}/rate` });
    await waitFor(() => expect(screen.getByTestId('project-rate-form')).toBeTruthy());
    expect(screen.getByText('FixPro MMC')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('project-rate-form-stars-4'));
    await fireEvent.press(screen.getByTestId('project-rate-form-submit'));
    await waitFor(() => expect(r.getPathname()).toBe(`/project/${M3.project}`));
    expect(api.find('POST', `/projects/${M3.project}/rating`)[0].body).toEqual({ stars: 4 });
  });

  it('projects list with the open request and its quote count', async () => {
    setup();
    secureStore().set('tf.language', 'az');
    const r = await renderRouter(APP_DIR, { initialUrl: '/orders' });
    await waitFor(() => expect(screen.getByTestId('orders-business')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('orders-business'));
    await waitFor(() => expect(screen.getByTestId(`project-card-${M3.project}`)).toBeTruthy());
    expect(r.getPathname()).toBe('/projects');
    expect(within(screen.getByTestId(`project-card-${M3.project}`)).getByText('Ofisin təmiri')).toBeTruthy();
    expect(within(screen.getByTestId(`project-status-${M3.project}`)).getByText('Təkliflər toplanır')).toBeTruthy();
    expect(screen.getByTestId(`project-quotes-${M3.project}`)).toBeTruthy();
  });
});
