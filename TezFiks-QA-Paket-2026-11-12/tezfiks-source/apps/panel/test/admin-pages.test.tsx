// @vitest-environment jsdom
/**
 * Admin pages (server components) rendered against a stubbed API: data from the contract endpoints, ErrorState
 * instead of a crash for NOT_FOUND / 404 (endpoints of lanes B2/B5 not deployed yet), redirect without a session.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { createTranslator } from 'next-intl';
import { panelMessages } from '@/i18n/messages';
import { renderPanel } from './render';
import { adminFixture, apiError, createCookieJar, makeJwt, mockApi, NavigationThrow, type ApiHandler } from './helpers';
import {
  AID,
  adminUsers,
  auditPage,
  categories,
  companiesPage,
  customerDetail,
  customersPage,
  dashboard,
  demoState,
  handymanDetail,
  handymenPage,
  invoicesPage,
  ledgerPage,
  paymentsPage,
  payoutsPage,
  projectDetail,
  projectsPage,
  publicConfig,
  requestDetail,
  settingsResponse,
} from './admin-fixtures';

const state = vi.hoisted(() => ({ jar: null as null | { store: unknown } }));

vi.mock('next/headers', () => ({
  cookies: async () => state.jar!.store,
  headers: async () => new Headers(),
}));

vi.mock('next/navigation', async () => {
  const { NavigationThrow: Nav } = await import('./helpers');
  return {
    redirect: (location: string) => {
      throw new Nav(`NEXT_REDIRECT;replace;${location};307;`, location);
    },
    notFound: () => {
      throw new Nav('NEXT_HTTP_ERROR_FALLBACK;404');
    },
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
    usePathname: () => '/admin',
  };
});

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('next-intl/server', () => ({
  getTranslations: async (opts: { locale: string; namespace?: string } | string) => {
    // Like src/i18n/request.ts: without an explicit locale the `locale` cookie decides (az by default).
    const jar = state.jar?.store as { get: (n: string) => { value: string } | undefined } | undefined;
    const requestLocale = jar?.get('locale')?.value ?? 'az';
    const o = typeof opts === 'string' ? { locale: requestLocale, namespace: opts } : opts;
    return createTranslator({ locale: o.locale, messages: panelMessages(o.locale), namespace: o.namespace as never });
  },
}));

vi.mock('@/components/map/panel-map', () => ({
  BAKU_CENTER: { lat: 40.4093, lng: 49.8671 },
  PanelMap: () => <div data-testid="map" />,
}));

import AdminDashboardPage from '@/app/admin/(panel)/page';
import AdminHandymenPage from '@/app/admin/(panel)/handymen/page';
import AdminHandymanPage from '@/app/admin/(panel)/handymen/[id]/page';
import AdminOrdersPage from '@/app/admin/(panel)/orders/page';
import AdminOrderPage from '@/app/admin/(panel)/orders/[id]/page';
import AdminCompanyPage from '@/app/admin/(panel)/companies/[id]/page';
import AdminCasesPage from '@/app/admin/(panel)/cases/page';
import AdminSettingsPage from '@/app/admin/(panel)/settings/page';
import AdminDemoPage from '@/app/admin/(panel)/demo/page';
import AdminMapPage from '@/app/admin/(panel)/map/page';
import AdminCompaniesPage from '@/app/admin/(panel)/companies/page';
import AdminCustomersPage from '@/app/admin/(panel)/customers/page';
import AdminCustomerPage from '@/app/admin/(panel)/customers/[id]/page';
import AdminPaymentsPage from '@/app/admin/(panel)/payments/page';
import AdminProjectsPage from '@/app/admin/(panel)/projects/page';
import AdminProjectPage from '@/app/admin/(panel)/projects/[id]/page';
import AdminCategoriesPage from '@/app/admin/(panel)/categories/page';
import AdminAuditPage from '@/app/admin/(panel)/audit/page';

function adminSession() {
  state.jar = createCookieJar({ tf_at: makeJwt(Math.floor(Date.now() / 1000) + 600), tf_rt: 'rt-admin-1234567890', tf_kind: 'admin' });
}

function api(handlers: Record<string, ApiHandler>) {
  return mockApi({ 'GET /admin/me': () => ({ status: 200, body: adminFixture }), ...handlers });
}

const sp = (v: Record<string, string> = {}) => Promise.resolve(v);
const params = (id: string) => Promise.resolve({ id });

/** Query string of the (last) API request to `path`, read from the stubbed fetch. */
function requestQuery(fetchMock: { mock: { calls: unknown[][] } }, path: string): URLSearchParams {
  const urls = fetchMock.mock.calls
    .map(([input]) => new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url))
    .filter((u) => u.pathname.replace('/tezfix/api', '') === path);
  expect(urls.length).toBeGreaterThan(0);
  return urls[urls.length - 1].searchParams;
}

beforeEach(() => adminSession());

describe('admin pages: session', () => {
  it('redirect to the login when there is no admin session', async () => {
    state.jar = createCookieJar({});
    mockApi({});
    await expect(AdminDashboardPage()).rejects.toBeInstanceOf(NavigationThrow);
  });

  it('redirects to the login when the API rejects the token while loading page data', async () => {
    api({ 'GET /admin/dashboard': () => apiError(401, 'SESSION_REVOKED') });
    const err = await AdminDashboardPage().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NavigationThrow);
    expect((err as NavigationThrow).location).toBe('/admin/login?expired=1');
  });
});

describe('Dashboard', () => {
  it('renders the board 05 KPIs and recent orders from the contract', async () => {
    const { calls } = api({
      'GET /admin/dashboard': () => ({ status: 200, body: dashboard }),
      'GET /config/public': () => ({ status: 200, body: publicConfig }),
    });
    renderPanel(await AdminDashboardPage());
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Dashboard — 01 Sentyabr 2026');
    expect(screen.getByText('142')).toBeTruthy();
    expect(screen.getByText('+12% dünənlə müqayisədə')).toBeTruthy();
    expect(screen.getByText('87')).toBeTruthy();
    expect(screen.getByText('onlayn: 34')).toBeTruthy();
    expect(screen.getByText('1.420 ₼')).toBeTruthy();
    expect(screen.getByText('142 sifariş × 10 ₼')).toBeTruthy();
    expect(screen.getByText('6,3%')).toBeTruthy();
    expect(screen.getByText('-1,1% bu həftə')).toBeTruthy();
    expect(screen.getByText('Təsdiq gözləyən ustalar: 9')).toBeTruthy();
    expect(screen.getByText('#2847')).toBeTruthy();
    // Server-to-server only: the bearer token is sent by the BFF, never rendered.
    expect(calls.find((c) => c.path === '/admin/dashboard')!.headers.authorization).toMatch(/^Bearer /);
    expect(document.body.innerHTML).not.toContain(calls[0].headers.authorization!.slice(7));
  });

  it('shows an ErrorState when the dashboard endpoint does not exist yet (404)', async () => {
    api({});
    renderPanel(await AdminDashboardPage());
    expect(screen.getByRole('alert').textContent).toContain('Məlumat tapılmadı');
  });
});

describe('Ustalar', () => {
  it('shows the tabs with counts and the rows of the selected tab', async () => {
    const { calls } = api({ 'GET /admin/handymen': () => ({ status: 200, body: handymenPage }) });
    renderPanel(await AdminHandymenPage({ searchParams: sp({ tab: 'pending', q: 'samir' }) }));
    const tabs = screen.getByRole('navigation', { name: 'tabs' });
    expect(within(tabs).getByText('Hamısı (312)')).toBeTruthy();
    const pending = within(tabs).getByText('Təsdiq gözləyən (9)');
    expect(pending.getAttribute('aria-current')).toBe('page');
    expect(within(tabs).getByText('Bloklanmış (4)').getAttribute('href')).toBe('/admin/handymen?tab=blocked&q=samir');
    expect(screen.getByText('Samir Quliyev')).toBeTruthy();
    const call = calls.find((c) => c.path === '/admin/handymen')!;
    expect(call).toBeTruthy();
  });

  it('renders the handyman detail with the KYC review and moderation actions', async () => {
    api({ [`GET /admin/handymen/${AID.handyman2}`]: () => ({ status: 200, body: handymanDetail }) });
    renderPanel(await AdminHandymanPage({ params: params(AID.handyman2) }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Samir Quliyev');
    expect((screen.getByAltText('Vəsiqənin ön üzü') as HTMLImageElement).getAttribute('src')).toBe(
      handymanDetail.kyc.files.idFront.url,
    );
    expect(screen.getByRole('button', { name: /Təsdiqlə/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Rədd et/ })).toBeTruthy();
    expect(screen.getByText('Gəlmədi')).toBeTruthy();
    expect(screen.getByText('+994552223344')).toBeTruthy();
  });

  it('shows an ErrorState for an unknown handyman', async () => {
    api({ [`GET /admin/handymen/${AID.handyman}`]: () => apiError(404, 'NOT_FOUND', 'Tapılmadı') });
    renderPanel(await AdminHandymanPage({ params: params(AID.handyman) }));
    expect(screen.getByRole('alert').textContent).toContain('Məlumat tapılmadı');
  });
});

describe('Sifariş detail', () => {
  it('shows the timeline oldest first, both phones, offers, ledger lines and the force-cancel action', async () => {
    api({ [`GET /admin/requests/${AID.request}`]: () => ({ status: 200, body: requestDetail }) });
    renderPanel(await AdminOrderPage({ params: params(AID.request) }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Sifariş #2847');
    const items = screen.getAllByRole('listitem').map((li) => li.textContent ?? '');
    const created = items.findIndex((t) => t.includes('Sifariş yaradıldı'));
    const accepted = items.findIndex((t) => t.includes('Usta qəbul etdi'));
    expect(created).toBeGreaterThanOrEqual(0);
    expect(accepted).toBeGreaterThan(created);
    expect(screen.getByText('custom.unknown_event')).toBeTruthy();
    expect(screen.getAllByText('+994552223344').length).toBeGreaterThan(0);
    expect(screen.getByText('+994501234567 · Fərdi usta')).toBeTruthy();
    expect(screen.getByText('1,5 km')).toBeTruthy();
    expect(screen.getByText('TezFiks')).toBeTruthy();
    expect(screen.getByText('1 / 2')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Məcburi ləğv/ })).toBeTruthy();
  });
});

describe('pages whose endpoints are not deployed yet render an ErrorState', () => {
  it.each([
    ['orders list', () => AdminOrdersPage({ searchParams: sp({ status: 'SEARCHING' }) })],
    ['order detail', () => AdminOrderPage({ params: params(AID.request) })],
    ['company detail', () => AdminCompanyPage({ params: params(AID.company) })],
    ['cases', () => AdminCasesPage({ searchParams: sp() })],
    ['live map', () => AdminMapPage()],
  ])('%s', async (_name, page) => {
    api({});
    renderPanel(await page());
    expect(screen.getByRole('alert').textContent).toContain('Məlumat tapılmadı');
  });

  it('shows the API message for other failures (e.g. forbidden)', async () => {
    api({ 'GET /admin/cases': () => apiError(403, 'FORBIDDEN', 'Bu əməliyyata icazəniz yoxdur') });
    renderPanel(await AdminCasesPage({ searchParams: sp() }));
    expect(screen.getByRole('alert').textContent).toContain('Bu əməliyyata icazəniz yoxdur');
  });
});

describe('Tənzimləmələr', () => {
  it('renders the settings form and the admins list', async () => {
    api({
      'GET /admin/settings': () => ({ status: 200, body: settingsResponse }),
      'GET /admin/admins': () => ({ status: 200, body: adminUsers }),
    });
    const { container } = renderPanel(await AdminSettingsPage());
    expect((screen.getByLabelText(/Sifariş haqqı \(usta\)/) as HTMLInputElement).value).toBe('10.00');
    expect(container.querySelector('[data-demo-badge]')).toBeTruthy();
    expect(screen.getByText('op@tezfiks.az')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Yeni admin/ })).toBeTruthy();
  });

  it('keeps the settings visible when only the admins endpoint fails', async () => {
    api({ 'GET /admin/settings': () => ({ status: 200, body: settingsResponse }) });
    renderPanel(await AdminSettingsPage());
    expect(screen.getByLabelText(/Sifariş haqqı \(usta\)/)).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Məlumat tapılmadı');
  });
});

describe('Demo', () => {
  it('explains that the simulator is off when the API is not in demo mode', async () => {
    const { calls } = api({ 'GET /config/public': () => ({ status: 200, body: { ...publicConfig, demoMode: false } }) });
    renderPanel(await AdminDemoPage());
    expect(screen.getByText('Demo rejimi söndürülüb')).toBeTruthy();
    expect(calls.some((c) => c.path === '/admin/demo')).toBe(false);
  });

  it('offers approved companies for bots to join, and solo bots when the company list is unavailable', async () => {
    const { fetchMock } = api({
      'GET /config/public': () => ({ status: 200, body: publicConfig }),
      'GET /admin/demo': () => ({ status: 200, body: demoState }),
      'GET /admin/categories': () => ({ status: 200, body: categories }),
      'GET /admin/companies': () => ({ status: 200, body: companiesPage }),
    });
    renderPanel(await AdminDemoPage());
    const select = screen.getByLabelText('Şirkət') as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(['Fərdi botlar', 'Təmir Pro ASC']);
    expect([...(screen.getByLabelText('Peşə') as HTMLSelectElement).options].map((o) => o.textContent)).toEqual([
      'İstənilən (simulyator seçir)',
      'Santexnik',
    ]);
    expect(requestQuery(fetchMock, '/admin/companies').get('limit')).toBe('100');
  });

  it('keeps the demo console working when the companies endpoint is missing', async () => {
    api({
      'GET /config/public': () => ({ status: 200, body: publicConfig }),
      'GET /admin/demo': () => ({ status: 200, body: demoState }),
    });
    renderPanel(await AdminDemoPage());
    expect([...(screen.getByLabelText('Şirkət') as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(['Fərdi botlar']);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('treats DEMO_DISABLED from the API the same way', async () => {
    api({
      'GET /config/public': () => ({ status: 200, body: publicConfig }),
      'GET /admin/demo': () => apiError(403, 'DEMO_DISABLED', 'Demo'),
    });
    renderPanel(await AdminDemoPage());
    expect(screen.getByText('Demo rejimi söndürülüb')).toBeTruthy();
  });
});

describe('Şirkətlər list', () => {
  it('shows the tabs with counts, the company rows and passes the tab and search to the API', async () => {
    const { fetchMock } = api({ 'GET /admin/companies': () => ({ status: 200, body: companiesPage }) });
    renderPanel(await AdminCompaniesPage({ searchParams: sp({ tab: 'pending', q: 'usta' }) }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Şirkətlər');
    const tabs = screen.getByRole('navigation', { name: 'tabs' });
    expect(within(tabs).getByText('Hamısı (21)').getAttribute('href')).toBe('/admin/companies?q=usta');
    expect(within(tabs).getByText('Təsdiq gözləyən (3)').getAttribute('aria-current')).toBe('page');
    expect(within(tabs).getByText('Bloklanmış (1)')).toBeTruthy();
    expect(screen.getByText('Usta Servis MMC')).toBeTruthy();
    expect(screen.getByText('MMC · VÖEN 1234567891')).toBeTruthy();
    expect(screen.getAllByText('+994507654321').length).toBe(2);
    // A company waiting for review links to its detail page with "Yoxla", an approved one with "Bax".
    expect(screen.getByRole('link', { name: /^Yoxla/ }).getAttribute('href')).toBe(`/admin/companies/${AID.company}`);
    expect(screen.getByRole('link', { name: /^Bax/ }).getAttribute('href')).toBe(`/admin/companies/${AID.account}`);
    const q = requestQuery(fetchMock, '/admin/companies');
    expect(q.get('tab')).toBe('pending');
    expect(q.get('q')).toBe('usta');
  });
});

describe('Müştərilər', () => {
  it('lists customers with type, company and balance, and passes the type filter to the API', async () => {
    const { fetchMock } = api({ 'GET /admin/customers': () => ({ status: 200, body: customersPage }) });
    renderPanel(await AdminCustomersPage({ searchParams: sp({ type: 'COMPANY' }) }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Müştərilər');
    expect(screen.getByText('Nizami Tağıyev')).toBeTruthy();
    expect(screen.getByText('Azər Holdinq')).toBeTruthy();
    expect(screen.getAllByText('Şirkət hesabı').length).toBeGreaterThan(0);
    expect(screen.getByText('Leyla Əhmədova')).toBeTruthy();
    expect(screen.getByText('-15,00 ₼')).toBeTruthy();
    const links = screen.getAllByRole('link', { name: /^Bax/ }).map((a) => a.getAttribute('href'));
    expect(links).toEqual([`/admin/customers/${AID.account}`, `/admin/customers/${AID.wallet}`]);
    expect(requestQuery(fetchMock, '/admin/customers').get('type')).toBe('COMPANY');
  });

  it('renders the customer detail with the wallet debt, recent requests and the block action', async () => {
    api({ [`GET /admin/customers/${AID.account}`]: () => ({ status: 200, body: customerDetail }) });
    renderPanel(await AdminCustomerPage({ params: params(AID.account) }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Nizami Tağıyev');
    expect(screen.getByText('+994552223344')).toBeTruthy();
    expect(screen.getByText('Azər Holdinq')).toBeTruthy();
    expect(screen.getByText('17')).toBeTruthy();
    expect(screen.getAllByText('-15,00 ₼').length).toBeGreaterThan(0);
    expect(screen.getByText('#2847')).toBeTruthy();
    expect(screen.getByRole('button', { name: /İstifadəçini blokla/ })).toBeTruthy();
  });
});

describe('Ödənişlər', () => {
  it('opens the ledger tab by default and loads the ledger journal', async () => {
    const { calls } = api({ 'GET /admin/ledger/transactions': () => ({ status: 200, body: ledgerPage }) });
    renderPanel(await AdminPaymentsPage({ searchParams: sp() }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Ödənişlər');
    const tabs = screen.getByRole('navigation', { name: 'tabs' });
    expect(within(tabs).getByText('Jurnal').getAttribute('aria-current')).toBe('page');
    expect(within(tabs).getByText('Köçürmələr').getAttribute('href')).toBe('/admin/payments?tab=payouts');
    expect(screen.getByText('Elvin Məmmədov')).toBeTruthy();
    expect(screen.getByText('TezFiks')).toBeTruthy();
    expect(calls.map((c) => c.path)).not.toContain('/admin/payments');
  });

  it('payment intents tab: payer, purpose, status filter passed to the API', async () => {
    const { fetchMock } = api({ 'GET /admin/payments': () => ({ status: 200, body: paymentsPage }) });
    renderPanel(await AdminPaymentsPage({ searchParams: sp({ tab: 'payments', status: 'SUCCEEDED' }) }));
    const tabs = screen.getByRole('navigation', { name: 'tabs' });
    expect(within(tabs).getByText('Ödəniş niyyətləri').getAttribute('aria-current')).toBe('page');
    expect(screen.getByText('Ödəyən Müştəri')).toBeTruthy();
    expect(screen.getByText('45,00 ₼')).toBeTruthy();
    expect(screen.getByText('mock')).toBeTruthy();
    const q = requestQuery(fetchMock, '/admin/payments');
    expect(q.get('status')).toBe('SUCCEEDED');
    expect(q.get('tab')).toBeNull();
  });

  it('payouts tab: owners, method, failure reason, run button and mark paid / failed only for pending payouts', async () => {
    api({ 'GET /admin/payouts': () => ({ status: 200, body: payoutsPage }) });
    renderPanel(await AdminPaymentsPage({ searchParams: sp({ tab: 'payouts' }) }));
    expect(screen.getByText('Elvin Məmmədov')).toBeTruthy();
    expect(screen.getByText('Usta Servis MMC')).toBeTruthy();
    expect(screen.getByText('250,00 ₼')).toBeTruthy();
    expect(screen.getByText(/\*\*\*\* 4242 · ELVIN MAMMADOV/)).toBeTruthy();
    expect(screen.getByText('Ödəniş üsulu yoxdur')).toBeTruthy();
    expect(screen.getByText('Kart bloklanıb')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Köçürmələri indi yarat/ })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Ödənildi$/ })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /^Uğursuz$/ })).toHaveLength(1);
  });

  it('invoices tab: number, project, VAT, and "mark paid" only for issued invoices', async () => {
    api({ 'GET /admin/invoices': () => ({ status: 200, body: invoicesPage }) });
    renderPanel(await AdminPaymentsPage({ searchParams: sp({ tab: 'invoices' }) }));
    expect(screen.getByText('TF-2026-000042')).toBeTruthy();
    expect(screen.getByText('Layihə P-31')).toBeTruthy();
    expect(screen.getByText('TF-2026-000041')).toBeTruthy();
    expect(screen.getAllByText('1.180,00 ₼')).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /^Ödənildi$/ })).toHaveLength(1);
  });

  it.each(['ledger', 'payments', 'payouts', 'invoices'])('%s tab renders an ErrorState while its endpoint is missing', async (tab) => {
    api({});
    renderPanel(await AdminPaymentsPage({ searchParams: sp({ tab }) }));
    expect(screen.getByRole('alert').textContent).toContain('Məlumat tapılmadı');
    // The tabs stay usable so the admin can switch to a working one.
    expect(screen.getByRole('navigation', { name: 'tabs' })).toBeTruthy();
  });
});

describe('Layihələr', () => {
  it('lists projects with a link to the detail and passes the status filter to the API', async () => {
    const { fetchMock } = api({ 'GET /admin/projects': () => ({ status: 200, body: projectsPage }) });
    renderPanel(await AdminProjectsPage({ searchParams: sp({ status: 'INVOICED' }) }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Layihələr');
    expect(screen.getByText('P-31')).toBeTruthy();
    expect(screen.getByText('Azər Holdinq')).toBeTruthy();
    expect(screen.getByText('Ofis təmiri')).toBeTruthy();
    expect(screen.getByRole('link', { name: /^Bax/ }).getAttribute('href')).toBe(`/admin/projects/${AID.file(91)}`);
    expect(requestQuery(fetchMock, '/admin/projects').get('status')).toBe('INVOICED');
  });

  it('renders the project detail: customer VÖEN, quotes with held fees, reports and the invoice', async () => {
    api({ [`GET /admin/projects/${AID.file(91)}`]: () => ({ status: 200, body: projectDetail }) });
    const { container } = renderPanel(await AdminProjectPage({ params: params(AID.file(91)) }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Layihə P-31');
    expect(screen.getByText('≈ 450 m² (3 mərtəbə, 12 otaq)')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Azər Holdinq' }).getAttribute('href')).toBe(`/admin/customers/${AID.account}`);
    expect(screen.getAllByText('1111111111').length).toBeGreaterThan(0);
    expect(screen.getByText('Təkliflər (2)')).toBeTruthy();
    expect(screen.getByText('4 × 3')).toBeTruthy();
    expect(screen.getByText('48,00 ₼')).toBeTruthy();
    expect(screen.getByText('tutulub')).toBeTruthy();
    expect(screen.getByText('bloklanıb')).toBeTruthy();
    expect(container.querySelectorAll('[data-awarded]')).toHaveLength(1);
    expect(screen.getByText('Gündəlik hesabatlar (1)')).toBeTruthy();
    expect(screen.getByText('İcra: 40%')).toBeTruthy();
    expect(screen.getByText('Hesab-faktura TF-2026-000042')).toBeTruthy();
    expect(screen.getByText('ƏDV 18%')).toBeTruthy();
    expect(screen.getByText('1.180,00 ₼')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Ödənildi$/ })).toBeTruthy();
  });

  it('pluralizes the completed-jobs count of a quote provider (en)', async () => {
    state.jar = createCookieJar({
      tf_at: makeJwt(Math.floor(Date.now() / 1000) + 600),
      tf_rt: 'rt-admin-1234567890',
      tf_kind: 'admin',
      locale: 'en',
    });
    api({ [`GET /admin/projects/${AID.file(91)}`]: () => ({ status: 200, body: projectDetail }) });
    renderPanel(await AdminProjectPage({ params: params(AID.file(91)) }), 'en');
    expect(screen.getByText(/· 1 job$/)).toBeTruthy();
    expect(screen.getByText(/· 348 jobs$/)).toBeTruthy();
  });
});

describe('Kateqoriyalar', () => {
  it('renders the category tree with the create action', async () => {
    api({ 'GET /admin/categories': () => ({ status: 200, body: categories }) });
    renderPanel(await AdminCategoriesPage());
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Kateqoriyalar');
    expect(screen.getByText('Ev təmiri')).toBeTruthy();
    expect(screen.getByText('Santexnik')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Yeni kateqoriya/ })).toBeTruthy();
  });
});

describe('Audit', () => {
  it('renders the log rows and passes the entity filters to the API', async () => {
    const { fetchMock } = api({ 'GET /admin/audit': () => ({ status: 200, body: auditPage }) });
    renderPanel(await AdminAuditPage({ searchParams: sp({ entityType: 'HandymanProfile', entityId: AID.handyman2 }) }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Audit');
    expect(screen.getByText('handyman.approve')).toBeTruthy();
    expect(screen.getByText('Aysel Admin')).toBeTruthy();
    expect(screen.getByText('HandymanProfile')).toBeTruthy();
    expect(screen.getByText('10.0.0.7')).toBeTruthy();
    expect(screen.getByText('payouts.run')).toBeTruthy();
    const q = requestQuery(fetchMock, '/admin/audit');
    expect(q.get('entityType')).toBe('HandymanProfile');
    expect(q.get('entityId')).toBe(AID.handyman2);
  });
});

describe('more pages render an ErrorState while their endpoints are missing', () => {
  it.each([
    ['companies list', () => AdminCompaniesPage({ searchParams: sp() })],
    ['customers list', () => AdminCustomersPage({ searchParams: sp() })],
    ['customer detail', () => AdminCustomerPage({ params: params(AID.account) })],
    ['projects list', () => AdminProjectsPage({ searchParams: sp() })],
    ['project detail', () => AdminProjectPage({ params: params(AID.file(91)) })],
    ['categories', () => AdminCategoriesPage()],
    ['audit', () => AdminAuditPage({ searchParams: sp() })],
  ])('%s', async (_name, page) => {
    api({});
    renderPanel(await page());
    expect(screen.getByRole('alert').textContent).toContain('Məlumat tapılmadı');
  });
});
