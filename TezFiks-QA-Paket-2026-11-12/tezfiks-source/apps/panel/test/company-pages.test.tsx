// @vitest-environment jsdom
/**
 * Company panel pages (server components, lane P2) rendered against a stubbed API: contract data, ErrorState for
 * endpoints of lanes still in progress (B3 assignments, B4 projects), manager-only access, privacy (worker phones are
 * shown to managers, customer phones only after contact unlock, never KYC files), no token in the HTML.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { createTranslator } from 'next-intl';
import { panelMessages } from '@/i18n/messages';
import { renderPanel } from './render';
import { apiError, createCookieJar, makeJwt, meFixture, membership, mockApi, NavigationThrow, type ApiHandler } from './helpers';
import {
  CID,
  OTHER_CID,
  PID,
  assignment,
  companyView,
  dashboard,
  earnings,
  electric,
  invite,
  invoice,
  members,
  offer,
  providerProject,
  transactions,
  wallet,
  workerLive,
} from './company-fixtures';

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
    usePathname: () => '/company',
  };
});

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('next-intl/server', () => ({
  getTranslations: async (opts: { locale: string; namespace?: string } | string) => {
    const jar = state.jar?.store as { get: (n: string) => { value: string } | undefined } | undefined;
    const requestLocale = jar?.get('locale')?.value ?? 'az';
    const o = typeof opts === 'string' ? { locale: requestLocale, namespace: opts } : opts;
    return createTranslator({ locale: o.locale, messages: panelMessages(o.locale), namespace: o.namespace as never });
  },
}));

vi.mock('@/components/map/panel-map', () => ({
  BAKU_CENTER: { lat: 40.4093, lng: 49.8671 },
  PanelMap: (props: { markers?: Array<{ id: string; label?: string; color?: string }> }) => (
    <div data-testid="map">
      {props.markers?.map((m) => (
        <span key={m.id} data-marker={m.id} data-color={m.color}>
          {m.label}
        </span>
      ))}
    </div>
  ),
}));

import CompanyDashboardPage from '@/app/company/[companyId]/page';
import CompanyDispatchPage from '@/app/company/[companyId]/dispatch/page';
import CompanyOrdersPage from '@/app/company/[companyId]/orders/page';
import CompanyOrderPage from '@/app/company/[companyId]/orders/[assignmentId]/page';
import CompanyWorkersPage from '@/app/company/[companyId]/workers/page';
import CompanyBalancePage from '@/app/company/[companyId]/balance/page';
import CompanyProjectsPage from '@/app/company/[companyId]/projects/page';
import CompanyProjectPage from '@/app/company/[companyId]/projects/[projectId]/page';
import CompanySettingsPage from '@/app/company/[companyId]/settings/page';

const NBSP = ' ';
const base = `/company/${CID}`;
const me = meFixture([membership(CID, 'MANAGER', 'FixPro MMC'), membership(OTHER_CID, 'WORKER', 'Başqa MMC')]);

function session(locale?: string) {
  state.jar = createCookieJar({
    tf_at: makeJwt(Math.floor(Date.now() / 1000) + 600),
    tf_rt: 'rt-company-1234567890',
    tf_kind: 'company',
    ...(locale ? { locale } : {}),
  });
}

function api(handlers: Record<string, ApiHandler>) {
  return mockApi({ 'GET /me': () => ({ status: 200, body: me }), ...handlers });
}

const params = <T extends Record<string, string>>(extra?: T) => Promise.resolve({ companyId: CID, ...(extra as T) });
const sp = (v: Record<string, string> = {}) => Promise.resolve(v);
const okJson = (body: unknown) => () => ({ status: 200, body });

function text(): string {
  return document.body.textContent ?? '';
}

beforeEach(() => session());

describe('company pages: access', () => {
  it('redirects to the company login without a session', async () => {
    state.jar = createCookieJar({});
    mockApi({});
    const err = await CompanyDashboardPage({ params: params() }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NavigationThrow);
    expect((err as NavigationThrow).location).toBe('/company/login?expired=1');
  });

  it('404 for a company where the user is only a worker', async () => {
    const { calls } = api({});
    const err = await CompanyDispatchPage({ params: Promise.resolve({ companyId: OTHER_CID }) }).catch((e: unknown) => e);
    expect((err as NavigationThrow).digest).toContain('404');
    expect(calls.every((c) => c.path === '/me')).toBe(true);
  });

  it('a revoked token while loading page data goes to the login', async () => {
    api({ [`GET ${base}/dashboard`]: () => apiError(401, 'SESSION_REVOKED') });
    const err = await CompanyDashboardPage({ params: params() }).catch((e: unknown) => e);
    expect((err as NavigationThrow).location).toBe('/company/login?expired=1');
  });
});

describe('Dashboard', () => {
  it('shows balance, today jobs, active jobs, workers online, revenue and fees', async () => {
    const { calls } = api({
      [`GET ${base}/dashboard`]: okJson(dashboard),
      [`GET ${base}`]: okJson(companyView()),
      [`GET ${base}/offers/current`]: okJson({ items: [offer()], serverNow: '2026-10-25T10:00:00.000Z' }),
    });
    renderPanel(await CompanyDashboardPage({ params: params() }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Dashboard');
    expect(text()).toContain(`230,00${NBSP}₼`);
    expect(text()).toContain(`Bloklanıb: 10,00${NBSP}₼`);
    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('2 / 4')).toBeTruthy();
    expect(text()).toContain(`420,00${NBSP}₼`);
    expect(text()).toContain(`70,00${NBSP}₼`);
    expect(screen.getByText('Dispatch: 1 yeni sifariş')).toBeTruthy();
    // The bearer token stays on the server.
    const token = calls[0]!.headers.authorization!.slice(7);
    expect(document.body.innerHTML).not.toContain(token);
  });

  it('warns while the company is not approved yet', async () => {
    api({
      [`GET ${base}/dashboard`]: okJson(dashboard),
      [`GET ${base}`]: okJson(companyView({ status: 'PENDING_REVIEW' })),
    });
    renderPanel(await CompanyDashboardPage({ params: params() }));
    expect(text()).toContain('Şirkət TezFiks tərəfindən yoxlanılır');
  });

  it('renders an ErrorState when the dashboard endpoint is missing', async () => {
    api({});
    renderPanel(await CompanyDashboardPage({ params: params() }));
    expect(screen.getByRole('alert').textContent).toContain('Məlumat tapılmadı');
  });

  it('renders in English with the locale cookie', async () => {
    session('en');
    api({ [`GET ${base}/dashboard`]: okJson(dashboard), [`GET ${base}`]: okJson(companyView()) });
    renderPanel(await CompanyDashboardPage({ params: params() }), 'en');
    expect(text()).toContain('Orders today');
    expect(text()).toContain('₼230.00');
  });
});

describe('Dispatch', () => {
  // Offer windows are relative to the real clock: the board compares expiresAt with serverNow.
  const handlers = (over: Record<string, ApiHandler> = {}) => ({
    [`GET ${base}/offers/current`]: () => ({ status: 200, body: { items: [fresh()], serverNow: new Date().toISOString() } }),
    [`GET ${base}/assignments`]: okJson({
      items: [
        assignment(),
        assignment({ id: PID.asg2, requestNumber: 2852, status: 'EN_ROUTE', etaSec: 720 }),
        assignment({ id: PID.asg3, requestNumber: 2853, status: 'PRICE_PROPOSED', price: { labor: 4000, materials: 0, total: 4000 } }),
      ],
      nextCursor: null,
    }),
    [`GET ${base}/workers/live`]: okJson({
      items: [workerLive(), workerLive({ handymanId: PID.kamran, firstName: 'Kamran', busy: true, assignmentId: PID.asg1 })],
    }),
    [`GET ${base}/wallet`]: okJson(wallet),
    [`GET ${base}`]: okJson(companyView()),
    ...over,
  });

  function fresh() {
    const now = Date.now();
    return offer({ sentAt: new Date(now - 2000).toISOString(), expiresAt: new Date(now + 28_000).toISOString() });
  }

  it('shows the incoming offer with countdown, fee note and the worker picker (board 04)', async () => {
    api(handlers({ [`GET ${base}/offers/current`]: okJson({ items: [fresh()], serverNow: new Date().toISOString() }) }));
    renderPanel(await CompanyDispatchPage({ params: params() }));
    const card = screen.getByTestId('offer-card');
    expect(within(card).getByRole('heading', { level: 3 }).textContent).toContain('Yeni sifariş #2851');
    expect(card.textContent).toContain('Elektrik — Rozetka dəyişimi');
    expect(card.textContent).toContain('M.Hadi küç. 12, Xətai');
    expect(card.textContent).toContain('Müştəri: Aysel Q.');
    expect(card.textContent).toContain(`Qəbulda şirkət balansından 10${NBSP}₼ tutulacaq`);
    expect(within(card).getByTestId('countdown').textContent).toMatch(/0:2\d/);
    const options = within(card).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining('Rauf Hüseynov'),
      expect.stringContaining('Tural Əliyev'),
      expect.stringContaining('Kamran Səfərov'),
    ]);
    expect(options[0]!.textContent).toContain('Boşdur');
    expect(options[0]!.getAttribute('aria-selected')).toBe('true');
    expect(options[2]!.textContent).toContain('Sifarişdədir');
    expect((options[2] as HTMLButtonElement).disabled).toBe(true);
    expect(within(card).getByRole('button', { name: /Qəbul et və göndər/ })).toBeTruthy();
    expect(within(card).getByRole('button', { name: /İmtina et/ })).toBeTruthy();
    // No customer phone or exact flat details in an offer.
    expect(card.textContent).not.toMatch(/\+994/);
    expect(screen.getByTestId('wallet-chip').textContent).toBe(`Balans: 230${NBSP}₼`);
  });

  it('groups active jobs by status and shows the workers on the map', async () => {
    api(handlers());
    renderPanel(await CompanyDispatchPage({ params: params() }));
    const col = (c: string) => document.querySelector(`[data-column="${c}"]`)!;
    expect(col('ACCEPTED').textContent).toContain('#2851');
    expect(col('EN_ROUTE').textContent).toContain('#2852');
    expect(col('EN_ROUTE').textContent).toContain('12 dəq məsafədə');
    expect(col('PRICE').textContent).toContain('#2853');
    const markers = screen.getByTestId('map').querySelectorAll('[data-marker]');
    expect(markers).toHaveLength(2);
    expect(screen.getByTestId('map-legend').textContent).toContain('Boşdur: 1');
    expect(screen.getByTestId('map-legend').textContent).toContain('Sifarişdədir: 1');
  });

  it('keeps working when the assignments endpoint (lane B3) is not deployed yet', async () => {
    api(handlers({ [`GET ${base}/assignments`]: () => apiError(404, 'NOT_FOUND') }));
    renderPanel(await CompanyDispatchPage({ params: params() }));
    expect(text()).toContain('Aktiv işləri indi yükləmək mümkün olmadı. Bir az sonra yenidən cəhd edin.');
    expect(screen.getByTestId('offer-card')).toBeTruthy();
  });

  it('shows the empty state without offers', async () => {
    api(handlers({ [`GET ${base}/offers/current`]: okJson({ items: [], serverNow: new Date().toISOString() }) }));
    renderPanel(await CompanyDispatchPage({ params: params() }));
    expect(text()).toContain('Hazırda yeni sifariş yoxdur');
  });
});

describe('Sifarişlər', () => {
  it('lists the jobs without any phone number', async () => {
    const { fetchMock } = api({
      [`GET ${base}/assignments`]: okJson({
        items: [assignment({ customerPhone: '+994551234567', contactUnlocked: true })],
        nextCursor: null,
      }),
    });
    renderPanel(await CompanyOrdersPage({ params: params(), searchParams: sp({ scope: 'history' }) }));
    expect(text()).toContain('#2851');
    expect(text()).toContain('Rauf Hüseynov');
    expect(text()).toContain('Aysel Q.');
    expect(text()).not.toMatch(/\+994/);
    const url = fetchMock.mock.calls.map(([u]) => new URL(String(u))).find((u) => u.pathname.endsWith('/assignments'))!;
    expect(url.searchParams.get('scope')).toBe('history');
    const tabs = screen.getByRole('navigation', { name: 'tabs' });
    expect(within(tabs).getByText('Tarixçə').getAttribute('aria-current')).toBe('page');
  });

  it('ErrorState while the assignments endpoint (lane B3) is missing', async () => {
    api({});
    renderPanel(await CompanyOrdersPage({ params: params(), searchParams: sp() }));
    expect(screen.getByRole('alert').textContent).toContain('Məlumat tapılmadı');
  });

  it('detail: worker phone for the manager, customer phone locked until unlock, manager price entry when ARRIVED', async () => {
    api({
      [`GET ${base}/assignments/${PID.asg1}`]: okJson(assignment({ status: 'ARRIVED', arrivedAt: '2026-10-25T10:20:00.000Z' })),
      [`GET ${base}`]: okJson(companyView({ finalPriceEntry: 'MANAGER' })),
    });
    renderPanel(await CompanyOrderPage({ params: params({ assignmentId: PID.asg1 }) }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Sifariş #2851');
    expect(screen.getByText('+994501112233')).toBeTruthy();
    expect(text()).toContain('Müştərinin telefonu usta ünvana yaxınlaşanda açılır.');
    expect(screen.getByRole('button', { name: /Qiyməti daxil et/ })).toBeTruthy();
    expect(text()).toContain('Mətbəxdə rozetka yanıb');
    expect(text()).toContain('Usta ünvana çatdı');
  });

  it('detail: no price entry when the worker enters the price; unlocked customer phone shown', async () => {
    api({
      [`GET ${base}/assignments/${PID.asg1}`]: okJson(
        assignment({ status: 'ARRIVED', customerPhone: '+994551234567', contactUnlocked: true }),
      ),
      [`GET ${base}`]: okJson(companyView({ finalPriceEntry: 'WORKER' })),
    });
    renderPanel(await CompanyOrderPage({ params: params({ assignmentId: PID.asg1 }) }));
    expect(screen.queryByRole('button', { name: /Qiyməti daxil et/ })).toBeNull();
    expect(text()).toContain('Bu şirkətdə yekun qiyməti usta özü daxil edir.');
    expect(screen.getByText('+994551234567')).toBeTruthy();
  });

  it('detail: an ACCEPTED job offers reassign and cancel', async () => {
    api({
      [`GET ${base}/assignments/${PID.asg1}`]: okJson(assignment()),
      [`GET ${base}`]: okJson(companyView()),
      [`GET ${base}/members`]: okJson({ items: members }),
    });
    renderPanel(await CompanyOrderPage({ params: params({ assignmentId: PID.asg1 }) }));
    expect(screen.getByRole('button', { name: /Ustanı dəyiş/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Ləğv et/ })).toBeTruthy();
  });

  it('detail: unknown job -> ErrorState', async () => {
    api({ [`GET ${base}/assignments/${PID.asg1}`]: () => apiError(404, 'NOT_FOUND') });
    renderPanel(await CompanyOrderPage({ params: params({ assignmentId: PID.asg1 }) }));
    expect(screen.getByRole('alert').textContent).toContain('Məlumat tapılmadı');
  });
});

describe('Ustalar', () => {
  it('lists members with their phones, roles, trades and presence, plus invite links; never KYC files', async () => {
    const { calls } = api({
      [`GET ${base}/members`]: okJson({ items: members }),
      [`GET ${base}/invites`]: okJson({ items: [invite] }),
      [`GET ${base}`]: okJson(companyView()),
    });
    renderPanel(await CompanyWorkersPage({ params: params() }));
    expect(text()).toContain('Komanda (5)');
    for (const phone of ['+994501112233', '+994552223344', '+994703334455', '+994774445566']) {
      expect(screen.getByText(phone)).toBeTruthy();
    }
    const kamran = document.querySelector(`[data-member-id="${PID.kamranUser}"]`)!;
    expect(kamran.textContent).toContain('Sifarişdədir');
    expect(kamran.textContent).toContain('Elektrik');
    // The manager's own row has no remove button.
    const self = document.querySelector(`[data-member-id="${PID.managerUser}"]`)!;
    expect(self.textContent).toContain('siz');
    expect(within(self as HTMLElement).queryByRole('button', { name: /Çıxar/ })).toBeNull();
    expect(text()).toContain(invite.url);
    expect(text()).toContain('2 / 10');
    // Only company endpoints: no KYC or admin data is requested for managers.
    expect(calls.some((c) => c.path.includes('/kyc') || c.path.startsWith('/admin'))).toBe(false);
    expect(document.body.innerHTML).not.toMatch(/idFront|selfie/i);
  });

  it('ErrorState sections when the endpoints fail', async () => {
    api({ [`GET ${base}/members`]: () => apiError(500, 'INTERNAL') });
    renderPanel(await CompanyWorkersPage({ params: params() }));
    expect(screen.getAllByRole('alert').length).toBeGreaterThanOrEqual(2);
  });
});

describe('Balans', () => {
  it('shows wallet, transactions, earnings, payouts and the masked payout card', async () => {
    api({
      [`GET ${base}/wallet`]: okJson(wallet),
      [`GET ${base}/wallet/transactions`]: okJson(transactions),
      [`GET ${base}/earnings`]: okJson(earnings),
      [`GET ${base}/payout-method`]: okJson({ method: earnings.payoutMethod }),
    });
    renderPanel(await CompanyBalancePage({ params: params(), searchParams: sp({ topup: 'done' }) }));
    expect(text()).toContain('Ödəniş tamamlandısa');
    expect(text()).toContain(`230,00${NBSP}₼`);
    expect(text()).toContain('Platforma haqqı');
    expect(text()).toContain('#2840');
    expect(text()).toContain(`-10,00${NBSP}₼`);
    expect(text()).toContain(`560,00${NBSP}₼`);
    expect(text()).toContain(`Kartla: 3 iş, 300,00${NBSP}₼`);
    expect(screen.getByTestId('payout-current').textContent).toContain('**** 4242');
    expect(screen.getByRole('button', { name: /Ödənişə keç/ })).toBeTruthy();
  });
});

describe('Layihələr', () => {
  it('ErrorState while the projects endpoints (lane B4) are missing', async () => {
    api({});
    renderPanel(await CompanyProjectsPage({ params: params(), searchParams: sp() }));
    expect(screen.getByRole('alert').textContent).toContain('Məlumat tapılmadı');
  });

  it('lists open projects acting as the company', async () => {
    const { fetchMock } = api({ 'GET /provider/projects/open': okJson({ items: [providerProject()] }) });
    renderPanel(await CompanyProjectsPage({ params: params(), searchParams: sp() }));
    expect(text()).toContain('#120');
    expect(text()).toContain('Ofis elektrik xətti');
    expect(text()).toContain('Bina Servis MMC');
    const url = fetchMock.mock.calls.map(([u]) => new URL(String(u))).find((u) => u.pathname.endsWith('/provider/projects/open'))!;
    expect(url.searchParams.get('companyId')).toBe(CID);
  });

  it('my projects tab uses scope active', async () => {
    const { fetchMock } = api({ 'GET /provider/projects/mine': okJson({ items: [] }) });
    renderPanel(await CompanyProjectsPage({ params: params(), searchParams: sp({ tab: 'active' }) }));
    expect(text()).toContain('Aktiv layihə yoxdur');
    const url = fetchMock.mock.calls.map(([u]) => new URL(String(u))).find((u) => u.pathname.endsWith('/provider/projects/mine'))!;
    expect(url.searchParams.get('scope')).toBe('active');
    expect(url.searchParams.get('companyId')).toBe(CID);
  });

  it('detail with an open quote window shows the quote form with the fee preview', async () => {
    api({
      [`GET /provider/projects/${PID.project}`]: okJson(providerProject({ quoteDeadline: new Date(Date.now() + 3_600_000).toISOString() })),
      [`GET ${base}/wallet`]: okJson(wallet),
    });
    renderPanel(await CompanyProjectPage({ params: params({ projectId: PID.project }) }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Layihə #120: Ofis elektrik xətti');
    // 10 ₼ × 3 workers × 5 days = 150 ₼
    expect(screen.getByTestId('quote-fee').textContent).toContain(`150${NBSP}₼`);
    expect(screen.getByRole('button', { name: /Təklif göndər/ })).toBeTruthy();
  });

  it('awarded project: own quote, reports, report form and completion; invoice when issued', async () => {
    const awarded = providerProject({
      status: 'IN_PROGRESS',
      isAwardedToMe: true,
      myQuote: {
        id: PID.quote,
        projectId: PID.project,
        status: 'ACCEPTED',
        provider: {
          type: 'COMPANY',
          handymanId: null,
          companyId: CID,
          name: 'FixPro MMC',
          photo: null,
          ratingAvg: 4.6,
          ratingCount: 40,
          completedCount: 120,
          isVatPayer: true,
        },
        totalAmount: 500000,
        workers: 3,
        days: 5,
        note: null,
        createdAt: '2026-10-25T10:00:00.000Z',
        feeHeld: 15000,
        feeCaptured: true,
      },
      reports: [
        {
          id: PID.report,
          reportDate: '2026-11-02',
          note: 'Kabel çəkildi',
          progressPercent: 40,
          photos: [],
          authorName: 'Elvin Məmmədov',
          createdAt: '2026-11-02T15:00:00.000Z',
        },
      ],
    });
    api({ [`GET /provider/projects/${PID.project}`]: okJson(awarded), [`GET ${base}/wallet`]: okJson(wallet) });
    const view = renderPanel(await CompanyProjectPage({ params: params({ projectId: PID.project }) }));
    expect(screen.getByTestId('my-quote').textContent).toContain(`5.000,00${NBSP}₼`);
    expect(text()).toContain('Kabel çəkildi');
    expect(text()).toContain('40%');
    expect(screen.getByRole('button', { name: /Hesabat əlavə et/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /İşi tamamla/ })).toBeTruthy();
    view.unmount();

    api({
      [`GET /provider/projects/${PID.project}`]: okJson({ ...awarded, status: 'INVOICED', invoice }),
      [`GET ${base}/wallet`]: okJson(wallet),
    });
    renderPanel(await CompanyProjectPage({ params: params({ projectId: PID.project }) }));
    const inv = screen.getByTestId('invoice');
    expect(inv.textContent).toContain('Hesab-faktura TF-2026-000012');
    expect(inv.textContent).toContain('ƏDV (18%)');
    expect(inv.textContent).toContain(`5.900,00${NBSP}₼`);
    expect(screen.queryByRole('button', { name: /İşi tamamla/ })).toBeNull();
  });
});

describe('Tənzimləmələr', () => {
  it('shows the final price choice, trades and the verification status without any KYC document', async () => {
    const { calls } = api({
      [`GET ${base}`]: okJson(companyView()),
      'GET /categories': okJson({
        items: [
          {
            id: 'e0000000-0000-4000-8000-000000000000',
            slug: 'ev',
            parentId: null,
            vertical: 'HOME',
            kind: 'GROUP',
            name: 'Ev ustaları',
            names: { az: 'Ev ustaları', ru: 'Дом', en: 'Home' },
            icon: null,
            featured: false,
            flow: 'INSTANT',
            emergencyAllowed: true,
            sortOrder: 0,
            active: true,
            keywords: [],
          },
          {
            id: electric.id,
            slug: 'elektrik',
            parentId: 'e0000000-0000-4000-8000-000000000000',
            vertical: 'HOME',
            kind: 'SERVICE',
            name: 'Elektrik',
            names: { az: 'Elektrik', ru: 'Электрик', en: 'Electrician' },
            icon: null,
            featured: true,
            flow: 'INSTANT',
            emergencyAllowed: true,
            sortOrder: 1,
            active: true,
            keywords: [],
          },
        ],
      }),
    });
    renderPanel(await CompanySettingsPage({ params: params() }));
    expect(text()).toContain('Yekun qiyməti kim daxil edir?');
    const manager = screen.getByRole('radio', { name: /İdarəedici daxil edir/ }) as HTMLInputElement;
    expect(manager.checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'Elektrik' }) as HTMLInputElement).checked).toBe(true);
    expect(text()).toContain('Ev ustaları');
    expect(text()).toContain('Sənədlərin yoxlanışı');
    expect(calls.some((c) => c.path.includes('/kyc') || c.path.startsWith('/admin'))).toBe(false);
  });
});
