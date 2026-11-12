import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import path from 'node:path';
import * as ImagePicker from 'expo-image-picker';
import type { InvoiceView, ProviderProjectView } from '@tezfiks/shared';
import { header, resetApp, UUID } from './pro-helpers';
import { providerProject } from './fixtures';
import { apiError, installPro, ok, on } from './m4-helpers';

const APP_DIR = path.join(__dirname, '..', 'src', 'app');
const PID = UUID(3000);

afterEach(() => resetApp());

function quote(over: Record<string, unknown> = {}) {
  return {
    id: UUID(5000),
    projectId: PID,
    status: 'SUBMITTED' as const,
    provider: { type: 'SOLO' as const, handymanId: UUID(1), companyId: null, name: 'Elvin M.', photo: null, ratingAvg: null, ratingCount: 0, completedCount: 0, isVatPayer: false },
    totalAmount: 450000,
    workers: 4,
    days: 3,
    note: null,
    createdAt: new Date().toISOString(),
    feeHeld: 12000,
    feeCaptured: false,
    ...over,
  };
}

describe('projects (B2B, provider side)', () => {
  it('lists open requests, shows the fee preview and submits a quote with an idempotency key', async () => {
    let project: ProviderProjectView = providerProject();
    const world = installPro({
      routes: [
        on('GET', '/provider/projects/open', () => ok({ items: [project] })),
        on('GET', '/provider/projects/mine', () => ok({ items: project.myQuote ? [project] : [] })),
        on('GET', `/provider/projects/${PID}`, () => ok(project)),
        on('POST', `/provider/projects/${PID}/quotes`, (c) => {
          const b = c.body as { totalAmount: number; workers: number; days: number };
          project = { ...project, myQuote: quote({ totalAmount: b.totalAmount, workers: b.workers, days: b.days, feeHeld: 1000 * b.workers * b.days }) };
          return ok(project.myQuote);
        }),
      ],
    });
    const r = await renderRouter(APP_DIR, { initialUrl: '/projects' });
    await waitFor(() => expect(screen.getByTestId(`project-${PID}`)).toBeTruthy());
    expect(screen.getByText('Ofis təmiri')).toBeTruthy();
    expect(screen.getByText('≈ 450 m² (3 mərtəbə, 12 otaq)')).toBeTruthy();
    await fireEvent.press(screen.getByTestId(`project-${PID}`));
    await waitFor(() => expect(r.getPathname()).toBe(`/projects/${PID}`));
    await waitFor(() => expect(screen.getByTestId('quote-form')).toBeTruthy());
    // prefilled 4 handymen × 3 days → 120 AZN held
    expect(screen.getByText(/^Təklif göndərildikdə balansınızdan 120\s₼ bloklanacaq/)).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('quote-days'), '2');
    expect(screen.getByText(/^Təklif göndərildikdə balansınızdan 80\s₼ bloklanacaq/)).toBeTruthy();

    await fireEvent.press(screen.getByTestId('quote-submit'));
    await waitFor(() => expect(screen.getByText('Bu sahəni doldurun')).toBeTruthy()); // total missing
    expect(world.calls.some((c) => c.method === 'POST' && c.path.endsWith('/quotes'))).toBe(false);

    await fireEvent.changeText(screen.getByTestId('quote-total'), '4500');
    await fireEvent.press(screen.getByTestId('quote-submit'));
    await waitFor(() => expect(screen.getByTestId('my-quote')).toBeTruthy());
    const post = world.calls.find((c) => c.method === 'POST' && c.path === `/provider/projects/${PID}/quotes`)!;
    expect(post.body).toEqual({ totalAmount: 450000, workers: 4, days: 2 });
    expect(header(post, 'Idempotency-Key')).toBeTruthy();
    expect(screen.getByTestId('my-quote-fee').props.children).toMatch(/^Platforma haqqı: 80\s₼ \(bloklanıb\)$/);
    expect(screen.getByTestId('quote-withdraw')).toBeTruthy();
  });

  it('withdraws a submitted quote', async () => {
    let project: ProviderProjectView = providerProject({ myQuote: quote() });
    const world = installPro({
      routes: [
        on('GET', `/provider/projects/${PID}`, () => ok(project)),
        on('POST', `/provider/quotes/${UUID(5000)}/withdraw`, () => {
          project = { ...project, myQuote: quote({ status: 'WITHDRAWN' }) };
          return ok(project.myQuote);
        }),
      ],
    });
    await renderRouter(APP_DIR, { initialUrl: `/projects/${PID}` });
    await waitFor(() => expect(screen.getByTestId('quote-withdraw')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('quote-withdraw'));
    await waitFor(() => expect(screen.getByText('Təklif geri götürüldü')).toBeTruthy());
    expect(world.calls.some((c) => c.path === `/provider/quotes/${UUID(5000)}/withdraw`)).toBe(true);
    // one quote per provider and project: the withdrawn quote stays visible, it cannot be withdrawn again and the
    // quote form does not come back (the server would answer CONFLICT ALREADY_QUOTED)
    await waitFor(() => expect(screen.queryByTestId('quote-withdraw')).toBeNull());
    expect(screen.getByTestId('my-quote')).toBeTruthy();
    expect(screen.getByText('Geri çəkildi')).toBeTruthy();
    expect(screen.queryByTestId('quote-form')).toBeNull();
  });

  it('awarded project: daily report with a photo, then complete → invoice with VAT', async () => {
    let project: ProviderProjectView = providerProject({ status: 'AWARDED', isAwardedToMe: true, myQuote: quote({ status: 'ACCEPTED', feeCaptured: true }) });
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///photos/site.jpg', width: 1200, height: 900, mimeType: 'image/jpeg', fileName: 'site.jpg' }],
    });
    const invoice: InvoiceView = {
      id: UUID(5500),
      number: 'TF-2026-000001',
      projectId: PID,
      projectNumber: 105,
      issuer: { type: 'SOLO', name: 'Elvin Məmmədov', voen: null, isVatPayer: true },
      customer: { name: 'Azər Holdinq', voen: '1234567890' },
      subtotal: 450000,
      vatRatePercent: 18,
      vatAmount: 81000,
      total: 531000,
      currency: 'AZN',
      status: 'ISSUED',
      issuedAt: '2026-11-03T10:00:00.000Z',
      paidAt: null,
      lines: [{ description: 'Ofis təmiri', amount: 450000 }],
    };
    const world = installPro({
      routes: [
        on('GET', `/provider/projects/${PID}`, () => ok(project)),
        on('POST', '/files', () => ok({ id: UUID(5600), kind: 'REPORT_PHOTO', url: 'https://x/f', contentType: 'image/jpeg', width: 1200, height: 900 })),
        on('POST', `/provider/projects/${PID}/reports`, (c) => {
          const b = c.body as { note: string; progressPercent: number };
          const report = { id: UUID(5700), reportDate: '2026-11-01', note: b.note, progressPercent: b.progressPercent, photos: [], authorName: 'Elvin M.', createdAt: new Date().toISOString() };
          project = { ...project, status: 'IN_PROGRESS', reports: [report] };
          return ok(report);
        }),
        on('POST', `/provider/projects/${PID}/complete`, () => {
          project = { ...project, status: 'INVOICED', invoice };
          return ok(invoice);
        }),
      ],
    });
    const r = await renderRouter(APP_DIR, { initialUrl: `/projects/${PID}` });
    await waitFor(() => expect(screen.getByTestId('project-awarded')).toBeTruthy());
    expect(screen.getByText('Hələ hesabat yoxdur')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('project-add-report'));
    await waitFor(() => expect(screen.getByTestId('report-screen')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('report-submit'));
    await waitFor(() => expect(screen.getByText('Görülən işi yazın')).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('report-note'), '1-ci mərtəbədə suvaq bitdi');
    await fireEvent.press(screen.getByTestId('report-progress-minus'));
    await fireEvent.press(screen.getByTestId('report-progress-minus'));
    expect(screen.getByText('İrəliləyiş: 40%')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('report-add-photo'));
    await waitFor(() => expect(screen.getByText('Şəkillər (1/5)')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('report-submit'));
    await waitFor(() => expect(r.getPathname()).toBe(`/projects/${PID}`));
    expect(world.calls.find((c) => c.path === `/provider/projects/${PID}/reports`)!.body).toEqual({
      note: '1-ci mərtəbədə suvaq bitdi',
      progressPercent: 40,
      photoFileIds: [UUID(5600)],
    });
    await waitFor(() => expect(screen.getByTestId(`report-${UUID(5700)}`)).toBeTruthy());

    await fireEvent.press(screen.getByTestId('project-complete'));
    await waitFor(() => expect(screen.getByTestId('project-complete-confirm')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('project-complete-confirm'));
    await waitFor(() => expect(screen.getByTestId('project-invoice')).toBeTruthy());
    const complete = world.calls.find((c) => c.path === `/provider/projects/${PID}/complete`)!;
    expect(complete.body).toEqual({});
    expect(header(complete, 'Idempotency-Key')).toBeTruthy();
    expect(screen.getByText('Hesab-faktura TF-2026-000001')).toBeTruthy();
    expect(screen.getByText('ƏDV (18%)')).toBeTruthy();
    expect(screen.getByTestId('invoice-vat').props.children).toMatch(/^810,00\s₼$/);
    expect(screen.getByTestId('invoice-total').props.children).toMatch(/^5\.310,00\s₼$/);
    expect(screen.queryByTestId('project-complete')).toBeNull();
  });

  it('a company manager quotes for the company (companyId in query and body)', async () => {
    const CID = UUID(9);
    const project = providerProject();
    const world = installPro({
      me: { handyman: null, companies: [{ companyId: CID, companyName: 'FixPro MMC', role: 'MANAGER', companyStatus: 'APPROVED' }] },
      profile: null,
      managedCompanies: [{ id: CID, name: 'FixPro MMC', status: 'APPROVED', role: 'MANAGER' }],
      routes: [
        on('GET', `/provider/projects/${PID}`, (_c, _m, q) => (q.companyId === CID ? ok(project) : apiError(403, 'FORBIDDEN'))),
        on('POST', `/provider/projects/${PID}/quotes`, () => ok(quote({ provider: { ...quote().provider, type: 'COMPANY', companyId: CID } }))),
      ],
    });
    await renderRouter(APP_DIR, { initialUrl: `/projects/${PID}?companyId=${CID}` });
    await waitFor(() => expect(screen.getByTestId('quote-form')).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('quote-total'), '3000');
    await fireEvent.press(screen.getByTestId('quote-submit'));
    await waitFor(() => expect(world.calls.some((c) => c.method === 'POST' && c.path.endsWith('/quotes'))).toBe(true));
    expect(world.calls.find((c) => c.method === 'POST' && c.path.endsWith('/quotes'))!.body).toEqual({ totalAmount: 300000, workers: 4, days: 3, companyId: CID });
  });

  it('a request whose window closed cannot be quoted', async () => {
    installPro({ routes: [on('GET', `/provider/projects/${PID}`, () => ok(providerProject({ quoteDeadline: '2020-01-01T00:00:00.000Z' })))] });
    await renderRouter(APP_DIR, { initialUrl: `/projects/${PID}` });
    await waitFor(() => expect(screen.getByTestId('project-closed')).toBeTruthy());
    expect(screen.queryByTestId('quote-form')).toBeNull();
  });
});
