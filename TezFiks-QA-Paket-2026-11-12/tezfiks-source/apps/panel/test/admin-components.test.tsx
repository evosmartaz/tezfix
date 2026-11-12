// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderPanel } from './render';
import { AID, categories, demoState, handymenPage, kycView, liveMap, settingsResponse } from './admin-fixtures';

const actions = vi.hoisted(() => ({
  adjustWalletAction: vi.fn(),
  approveHandymanAction: vi.fn(),
  rejectHandymanAction: vi.fn(),
  blockHandymanAction: vi.fn(),
  unblockHandymanAction: vi.fn(),
  clearStrikesAction: vi.fn(),
  approveCompanyAction: vi.fn(),
  rejectCompanyAction: vi.fn(),
  blockCompanyAction: vi.fn(),
  unblockCompanyAction: vi.fn(),
  blockUserAction: vi.fn(),
  unblockUserAction: vi.fn(),
  listHandymenAction: vi.fn(),
  listCompaniesAction: vi.fn(),
  listCustomersAction: vi.fn(),
  updateCategoryAction: vi.fn(),
  createCategoryAction: vi.fn(),
  updateSettingsAction: vi.fn(),
  liveMapAction: vi.fn(),
  demoCreateRequestAction: vi.fn(),
  demoSpawnBotsAction: vi.fn(),
  demoClearBotsAction: vi.fn(),
  demoConfigAction: vi.fn(),
  resolveCaseAction: vi.fn(),
  redispatchCaseAction: vi.fn(),
  rejectCaseAction: vi.fn(),
  addCaseNoteAction: vi.fn(),
  listCasesAction: vi.fn(),
}));
vi.mock('@/features/admin/actions', () => actions);

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/admin' }));

// Map stub: lists the markers as buttons and offers a "map click" at a fixed point.
vi.mock('@/components/map/panel-map', () => ({
  BAKU_CENTER: { lat: 40.4093, lng: 49.8671 },
  PanelMap: (props: {
    markers?: Array<{ id: string; label?: string }>;
    polygons?: Array<{ id: string }>;
    onMarkerClick?: (id: string) => void;
    onMapClick?: (p: { lat: number; lng: number }) => void;
  }) => (
    <div data-testid="map" data-polygons={props.polygons?.length ?? 0}>
      {props.markers?.map((m) => (
        <button key={m.id} type="button" onClick={() => props.onMarkerClick?.(m.id)}>
          marker {m.id}
        </button>
      ))}
      {props.onMapClick ? (
        <button type="button" onClick={() => props.onMapClick?.({ lat: 40.38, lng: 49.84 })}>
          map click
        </button>
      ) : null}
    </div>
  ),
}));

import { LoadError } from '@/features/admin/components/load-error';
import { KycReview } from '@/features/admin/components/kyc-review';
import { OrderRows } from '@/features/admin/components/order-rows';
import { HandymenTable } from '@/features/admin/components/provider-tables';
import { WalletAdjustDialog } from '@/features/admin/components/wallet-adjust-dialog';
import { HandymanActions, UserBlockActions } from '@/features/admin/components/provider-actions';
import { CategoryManager } from '@/features/admin/components/category-manager';
import { SettingsFormView } from '@/features/admin/components/settings-form';
import { DemoConsole, demoConfigPatch, demoConfigToForm } from '@/features/admin/components/demo-console';
import { LiveMapView } from '@/features/admin/components/live-map-view';
import { CaseActions } from '@/features/admin/components/case-components';
import { matchesAdminEvent } from '@/features/admin/components/live-refresh';
import { adminNav } from '@/features/admin/nav';
import { dashboard } from './admin-fixtures';

beforeEach(() => {
  for (const fn of Object.values(actions)) fn.mockReset();
  for (const fn of Object.values(router)) fn.mockReset();
});

const lastButton = (name: string | RegExp) => {
  const all = screen.getAllByRole('button', { name });
  return all[all.length - 1];
};

describe('LoadError', () => {
  it('explains NOT_FOUND (unknown id or endpoint not deployed yet) and retries with a refresh', () => {
    renderPanel(<LoadError error={{ ok: false, code: 'NOT_FOUND', status: 404, message: 'Not found' }} />);
    expect(screen.getByRole('alert').textContent).toContain('Məlumat tapılmadı');
    fireEvent.click(screen.getByRole('button', { name: 'Yenidən cəhd et' }));
    expect(router.refresh).toHaveBeenCalledOnce();
  });

  it('shows the API message for other errors', () => {
    renderPanel(<LoadError error={{ ok: false, code: 'FORBIDDEN', status: 403, message: 'Bu əməliyyata icazəniz yoxdur' }} />);
    expect(screen.getByText('Bu əməliyyata icazəniz yoxdur')).toBeTruthy();
  });
});

describe('KycReview', () => {
  it('shows every document with the signed admin URL from the API', () => {
    renderPanel(<KycReview kyc={kycView} />);
    const front = screen.getByAltText('Vəsiqənin ön üzü') as HTMLImageElement;
    expect(front.getAttribute('src')).toBe(kycView.files.idFront.url);
    expect((screen.getByAltText('Vəsiqənin arxa üzü') as HTMLImageElement).getAttribute('src')).toBe(kycView.files.idBack.url);
    expect(screen.getByAltText('Selfi: göz qırpmaq')).toBeTruthy();
    expect(screen.getByText('PDF')).toBeTruthy();
    expect(screen.getByText('Peşə sübutu 1')).toBeTruthy();
    expect(screen.getByText('Aparılmayıb')).toBeTruthy();
  });

  it('says when nothing was submitted', () => {
    renderPanel(<KycReview kyc={null} />);
    expect(screen.getByText('Sənəd göndərilməyib')).toBeTruthy();
  });
});

describe('OrderRows (Son sifarişlər)', () => {
  it('shows the assignment status while a handyman is on the way and the request status otherwise', () => {
    const { container } = renderPanel(<OrderRows rows={dashboard.recentOrders} />);
    expect(screen.getByText('#2847')).toBeTruthy();
    expect(screen.getByText('Usta yolda')).toBeTruthy();
    expect(screen.getByText('Usta axtarılır')).toBeTruthy();
    expect(container.querySelector('a[href="/admin/orders/' + AID.request + '"]')).toBeTruthy();
  });
});

describe('HandymenTable (board 05 columns)', () => {
  it('renders the server page with names, trades, rating, orders, balance, status and the review link', () => {
    renderPanel(<HandymenTable query={{}} initialPage={handymenPage} />);
    for (const header of ['Usta', 'Peşə', 'Reytinq', 'Sifariş sayı', 'Balans', 'Status', 'Əməliyyat']) {
      expect(screen.getByRole('columnheader', { name: header })).toBeTruthy();
    }
    expect(screen.getByText('Elvin Məmmədov')).toBeTruthy();
    expect(screen.getByText('348')).toBeTruthy();
    expect(screen.getByText('Aktiv')).toBeTruthy();
    expect(screen.getByText('Təsdiq gözləyir')).toBeTruthy();
    const review = screen.getByRole('link', { name: /Yoxla/ });
    expect(review.getAttribute('href')).toBe(`/admin/handymen/${AID.handyman2}`);
    expect(actions.listHandymenAction).not.toHaveBeenCalled();
  });
});

describe('WalletAdjustDialog', () => {
  async function open() {
    renderPanel(<WalletAdjustDialog owner={{ type: 'HANDYMAN', id: AID.handyman }} revalidate="/admin/handymen/x" allowEarnings />);
    fireEvent.click(screen.getByRole('button', { name: /Balansa düzəliş/ }));
    await screen.findByLabelText('Məbləğ (₼)');
  }

  it('validates the amount before calling the action', async () => {
    await open();
    fireEvent.change(screen.getByLabelText('Məbləğ (₼)'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Səbəb'), { target: { value: 'Bonus' } });
    fireEvent.click(screen.getByRole('button', { name: 'Təsdiqlə' }));
    expect(await screen.findByText('0,01 – 100 000 ₼ arası məbləğ daxil edin')).toBeTruthy();
    expect(actions.adjustWalletAction).not.toHaveBeenCalled();
  });

  it('posts a signed qəpik amount and retries with the same idempotency key', async () => {
    actions.adjustWalletAction
      .mockResolvedValueOnce({ ok: false, code: 'NETWORK', message: 'Şəbəkə xətası' })
      .mockResolvedValueOnce({ ok: true, data: { wallet: {}, transactionId: AID.wallet } });
    await open();
    fireEvent.change(screen.getByLabelText('Əməliyyat'), { target: { value: 'debit' } });
    fireEvent.change(screen.getByLabelText('Məbləğ (₼)'), { target: { value: '2,50' } });
    fireEvent.change(screen.getByLabelText('Hesab'), { target: { value: 'EARNINGS' } });
    fireEvent.change(screen.getByLabelText('Səbəb'), { target: { value: 'Düzəliş' } });
    fireEvent.click(screen.getByRole('button', { name: 'Təsdiqlə' }));
    expect(await screen.findByText('Şəbəkə xətası')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Təsdiqlə' }));
    await waitFor(() => expect(actions.adjustWalletAction).toHaveBeenCalledTimes(2));
    const [first, second] = actions.adjustWalletAction.mock.calls;
    expect(first[0]).toEqual({
      owner: { type: 'HANDYMAN', id: AID.handyman },
      account: 'EARNINGS',
      amount: -250,
      reason: 'Düzəliş',
    });
    expect(first[1]).toEqual(second[1]);
    expect(String(first[1]).length).toBeGreaterThanOrEqual(8);
    expect(first[2]).toBe('/admin/handymen/x');
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });
});

describe('HandymanActions', () => {
  it('requires a reason of at least 3 characters to reject', async () => {
    actions.rejectHandymanAction.mockResolvedValue({ ok: true, data: {} });
    renderPanel(<HandymanActions handymanId={AID.handyman2} status="PENDING_REVIEW" strikes={0} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rədd et' }));
    const reason = await screen.findByLabelText('Səbəb');
    fireEvent.change(reason, { target: { value: 'ab' } });
    fireEvent.click(lastButton('Rədd et'));
    expect(await screen.findByText('Səbəb 3–500 simvol olmalıdır')).toBeTruthy();
    expect(actions.rejectHandymanAction).not.toHaveBeenCalled();
    fireEvent.change(reason, { target: { value: 'Vəsiqə oxunmur' } });
    fireEvent.click(lastButton('Rədd et'));
    await waitFor(() => expect(actions.rejectHandymanAction).toHaveBeenCalledWith(AID.handyman2, { reason: 'Vəsiqə oxunmur' }));
  });

  it('approves with the extracted ID fields (upper-cased) and rejects an invalid number', async () => {
    actions.approveHandymanAction.mockResolvedValue({ ok: true, data: {} });
    renderPanel(<HandymanActions handymanId={AID.handyman2} status="PENDING_REVIEW" strikes={0} />);
    fireEvent.click(screen.getByRole('button', { name: 'Təsdiqlə' }));
    const doc = await screen.findByLabelText('Vəsiqə nömrəsinin son 4 simvolu');
    fireEvent.change(doc, { target: { value: 'ab1' } });
    fireEvent.click(lastButton('Təsdiqlə'));
    expect(await screen.findByText('Məlumatları yoxlayın: nömrə 4 simvol olmalıdır')).toBeTruthy();
    expect(actions.approveHandymanAction).not.toHaveBeenCalled();
    fireEvent.change(doc, { target: { value: 'ab12' } });
    fireEvent.change(screen.getByLabelText('Doğum tarixi'), { target: { value: '1990-05-01' } });
    fireEvent.click(lastButton('Təsdiqlə'));
    await waitFor(() =>
      expect(actions.approveHandymanAction).toHaveBeenCalledWith(AID.handyman2, {
        extracted: { docNumberLast4: 'AB12', birthDate: '1990-05-01' },
      }),
    );
  });

  it('offers unblock for blocked handymen and clear strikes only when there are strikes', () => {
    renderPanel(<HandymanActions handymanId={AID.handyman} status="BLOCKED" strikes={2} />);
    expect(screen.getByRole('button', { name: /Blokdan çıxar/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Blokla$/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Xəbərdarlıqları sil/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Rədd et' })).toBeNull();
  });

  it('blocks a user account with a reason and the page to revalidate', async () => {
    actions.blockUserAction.mockResolvedValue({ ok: true, data: { ok: true } });
    renderPanel(<UserBlockActions userId={AID.user} status="ACTIVE" revalidate="/admin/customers/a" />);
    fireEvent.click(screen.getByRole('button', { name: /İstifadəçini blokla/ }));
    fireEvent.change(await screen.findByLabelText('Səbəb'), { target: { value: 'Saxta sifarişlər' } });
    fireEvent.click(lastButton(/İstifadəçini blokla/));
    await waitFor(() =>
      expect(actions.blockUserAction).toHaveBeenCalledWith(AID.user, { reason: 'Saxta sifarişlər' }, '/admin/customers/a'),
    );
  });
});

describe('CategoryManager', () => {
  it('renders the tree and deactivates a category', async () => {
    actions.updateCategoryAction.mockResolvedValue({ ok: true, data: { ...categories.items[1], active: false } });
    const { container } = renderPanel(<CategoryManager items={categories.items} />);
    expect(screen.getByText('Ev təmiri')).toBeTruthy();
    const row = container.querySelector('[data-category="santexnik"]') as HTMLElement;
    expect(row.style.paddingLeft).toBe('2.5rem');
    fireEvent.click(within(row).getByRole('button', { name: /Deaktiv et/ }));
    await waitFor(() => expect(actions.updateCategoryAction).toHaveBeenCalledWith(AID.category, { active: false }));
  });

  it('validates the slug and creates a category under its group', async () => {
    actions.createCategoryAction.mockResolvedValue({ ok: true, data: categories.items[1] });
    renderPanel(<CategoryManager items={categories.items} />);
    fireEvent.click(screen.getByRole('button', { name: /Yeni kateqoriya/ }));
    fireEvent.change(await screen.findByLabelText('Slug'), { target: { value: 'Bad slug' } });
    fireEvent.click(screen.getByRole('button', { name: 'Yadda saxla' }));
    expect(await screen.findByText('2–60 simvol: a-z, 0-9 və tire')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Slug'), { target: { value: 'elektrik' } });
    fireEvent.change(screen.getByLabelText('Valideyn qrup'), { target: { value: AID.group } });
    fireEvent.change(screen.getByLabelText('Ad (az)'), { target: { value: 'Elektrik' } });
    fireEvent.change(screen.getByLabelText('Ad (ru)'), { target: { value: 'Электрик' } });
    fireEvent.change(screen.getByLabelText('Ad (en)'), { target: { value: 'Electrician' } });
    fireEvent.change(screen.getByLabelText('Açar sözlər'), { target: { value: 'işıq, rozetka' } });
    fireEvent.click(screen.getByRole('button', { name: 'Yadda saxla' }));
    await waitFor(() => expect(actions.createCategoryAction).toHaveBeenCalledOnce());
    expect(actions.createCategoryAction.mock.calls[0][0]).toMatchObject({
      slug: 'elektrik',
      parentId: AID.group,
      kind: 'SERVICE',
      names: { az: 'Elektrik', ru: 'Электрик', en: 'Electrician' },
      keywords: ['işıq', 'rozetka'],
    });
  });
});

describe('SettingsFormView', () => {
  it('shows the demo badge and sends only the changed setting in qəpik', async () => {
    actions.updateSettingsAction.mockResolvedValue({ ok: true, data: settingsResponse });
    const { container } = renderPanel(
      <SettingsFormView settings={settingsResponse.settings} defaults={settingsResponse.defaults} demoMode canEdit />,
    );
    expect(container.querySelector('[data-demo-badge]')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Sifariş haqqı \(usta\)/), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: /Yadda saxla/ }));
    await waitFor(() => expect(actions.updateSettingsAction).toHaveBeenCalledWith({ requestFee: 1200 }));
  });

  it('flags invalid values without calling the action', async () => {
    renderPanel(<SettingsFormView settings={settingsResponse.settings} defaults={settingsResponse.defaults} demoMode={false} canEdit />);
    fireEvent.change(screen.getByLabelText(/Təklifin müddəti/), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: /Yadda saxla/ }));
    expect(await screen.findByText('Yanlış dəyər')).toBeTruthy();
    expect(actions.updateSettingsAction).not.toHaveBeenCalled();
  });

  it('is read-only for operators', () => {
    renderPanel(<SettingsFormView settings={settingsResponse.settings} defaults={settingsResponse.defaults} demoMode={false} canEdit={false} />);
    expect((screen.getByLabelText(/Təklifin müddəti/) as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: /Yadda saxla/ })).toBeNull();
  });
});

describe('demo console', () => {
  it('builds a config patch with only the changes and enforces the contract ranges', () => {
    const form = demoConfigToForm(demoState.config);
    expect(form.priceLabor).toBe('30.00');
    expect(demoConfigPatch(form, demoState.config)).toEqual({});
    expect(demoConfigPatch({ ...form, autoAccept: false, speedKmh: '60', priceMaterials: '7,5' }, demoState.config)).toEqual({
      autoAccept: false,
      speedKmh: 60,
      priceMaterials: 750,
    });
    expect(demoConfigPatch({ ...form, acceptDelaySec: '0' }, demoState.config)).toBeNull();
    expect(demoConfigPatch({ ...form, speedKmh: '301' }, demoState.config)).toBeNull();
  });

  it('creates a test request at the clicked map point', async () => {
    actions.demoCreateRequestAction.mockResolvedValue({ ok: true, data: { requestId: AID.request, number: 2850 } });
    renderPanel(<DemoConsole state={demoState} categories={categories.items} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sifariş yarat' }));
    expect((await screen.findAllByText('Əvvəlcə xəritədə nöqtə seçin')).length).toBeGreaterThan(0);
    expect(actions.demoCreateRequestAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'map click' }));
    expect(screen.getByText('Nöqtə: 40.38000, 49.84000')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sifariş yarat' }));
    await waitFor(() =>
      expect(actions.demoCreateRequestAction).toHaveBeenCalledWith({
        categoryId: AID.category,
        lat: 40.38,
        lng: 49.84,
        timing: 'NOW',
        slots: 1,
      }),
    );
    expect((await screen.findByRole('link', { name: /Sifariş #2850/ })).getAttribute('href')).toBe(`/admin/orders/${AID.request}`);
  });

  it('spawns bots around the selected point', async () => {
    actions.demoSpawnBotsAction.mockResolvedValue({ ok: true, data: demoState });
    renderPanel(<DemoConsole state={demoState} categories={categories.items} />);
    fireEvent.click(screen.getByRole('button', { name: 'map click' }));
    fireEvent.change(screen.getByLabelText('Say (1–50)'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: /^Yarat$/ }));
    await waitFor(() =>
      expect(actions.demoSpawnBotsAction).toHaveBeenCalledWith({ count: 8, radiusKm: 3, center: { lat: 40.38, lng: 49.84 } }),
    );
  });

  it('spawns bots with a trade as workers of a chosen company', async () => {
    actions.demoSpawnBotsAction.mockResolvedValue({ ok: true, data: demoState });
    renderPanel(
      <DemoConsole state={demoState} categories={categories.items} companies={[{ id: AID.company, name: 'Usta Servis MMC' }]} />,
    );
    fireEvent.change(screen.getByLabelText('Peşə'), { target: { value: AID.category } });
    fireEvent.change(screen.getByLabelText('Şirkət'), { target: { value: AID.company } });
    fireEvent.click(screen.getByRole('button', { name: /^Yarat$/ }));
    await waitFor(() =>
      expect(actions.demoSpawnBotsAction).toHaveBeenCalledWith({
        count: 5,
        radiusKm: 3,
        center: { lat: 40.4093, lng: 49.8671 },
        tradeIds: [AID.category],
        companyId: AID.company,
      }),
    );
  });

  it('does not call the API for an invalid bot count', async () => {
    renderPanel(<DemoConsole state={demoState} categories={categories.items} />);
    fireEvent.change(screen.getByLabelText('Say (1–50)'), { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: /^Yarat$/ }));
    expect(await screen.findByText('Say 1–50, radius 0,3–20 km olmalıdır')).toBeTruthy();
    expect(actions.demoSpawnBotsAction).not.toHaveBeenCalled();
  });
});

describe('LiveMapView', () => {
  it('shows legend counts, draws hexagons for searching requests, polls every 10 s and opens a clicked marker', async () => {
    vi.useFakeTimers();
    try {
      actions.liveMapAction.mockResolvedValue({ ok: true, data: { ...liveMap, requests: [] } });
      renderPanel(<LiveMapView initial={liveMap} />);
      expect(screen.getByTestId('map').getAttribute('data-polygons')).toBe('1');
      const legend = screen.getByRole('list', { name: 'İşarələr' });
      expect(within(legend).getByText('Onlayn:').parentElement?.textContent).toContain('1');
      fireEvent.click(screen.getByRole('button', { name: `marker r:${AID.request}` }));
      expect(router.push).toHaveBeenCalledWith(`/admin/orders/${AID.request}`);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(actions.liveMapAction).toHaveBeenCalledOnce();
      expect(screen.getByTestId('map').getAttribute('data-polygons')).toBe('0');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('CaseActions', () => {
  it('is hidden once the case is closed', () => {
    const { container } = renderPanel(<CaseActions caseId={AID.case} caseType="GUARANTEE" status="RESOLVED" />);
    expect(container.textContent).toBe('');
  });

  it('resolves a price dispute with a new price', async () => {
    actions.resolveCaseAction.mockResolvedValue({ ok: true, data: {} });
    renderPanel(<CaseActions caseId={AID.case} caseType="PRICE_DISPUTE" status="OPEN" />);
    expect(screen.queryByRole('button', { name: /Təkrar göndər/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Həll et/ }));
    fireEvent.change(await screen.findByLabelText('Nəticə'), { target: { value: 'REPROPOSE_PRICE' } });
    fireEvent.change(screen.getByLabelText('İş haqqı (₼)'), { target: { value: '40' } });
    fireEvent.change(screen.getByLabelText('Material (₼)'), { target: { value: '12,50' } });
    fireEvent.change(screen.getByLabelText('Qərar qeydi'), { target: { value: 'Razılaşdırıldı' } });
    fireEvent.click(screen.getByRole('button', { name: 'Təsdiqlə' }));
    await waitFor(() =>
      expect(actions.resolveCaseAction).toHaveBeenCalledWith(AID.case, {
        note: 'Razılaşdırıldı',
        outcome: 'REPROPOSE_PRICE',
        price: { labor: 4000, materials: 1250 },
      }),
    );
  });

  it('offers a guarantee redispatch with an optional note', async () => {
    actions.redispatchCaseAction.mockResolvedValue({ ok: true, data: {} });
    renderPanel(<CaseActions caseId={AID.case} caseType="GUARANTEE" status="OPEN" />);
    fireEvent.click(screen.getByRole('button', { name: /Təkrar göndər/ }));
    await screen.findByLabelText('Qeyd (istəyə bağlı)');
    fireEvent.click(lastButton(/Təkrar göndər/));
    await waitFor(() => expect(actions.redispatchCaseAction).toHaveBeenCalledWith(AID.case, {}));
  });
});

describe('admin live updates and navigation', () => {
  it('matches admin event types by prefix', () => {
    expect(matchesAdminEvent('kyc.submitted', ['kyc'])).toBe(true);
    expect(matchesAdminEvent('case.opened', ['kyc', 'handyman'])).toBe(false);
    expect(matchesAdminEvent('anything', undefined)).toBe(true);
  });

  it('matches the event types the API actually emits (upper case, underscores)', () => {
    // apps/api kyc.service emits KYC_SUBMITTED / COMPANY_KYC_SUBMITTED.
    expect(matchesAdminEvent('KYC_SUBMITTED', ['kyc', 'handyman'])).toBe(true);
    expect(matchesAdminEvent('COMPANY_KYC_SUBMITTED', ['kyc', 'company'])).toBe(true);
    expect(matchesAdminEvent('COMPANY_KYC_SUBMITTED', ['kyc', 'handyman'])).toBe(false);
    expect(matchesAdminEvent('HANDYMAN_BLOCKED', ['kyc', 'handyman'])).toBe(true);
    expect(matchesAdminEvent('handymanStatus', ['handyman'])).toBe(true);
    expect(matchesAdminEvent('CASE_OPENED', ['case'])).toBe(true);
    expect(matchesAdminEvent('kyc-submitted', ['KYC'])).toBe(true);
    expect(matchesAdminEvent('kycx.submitted', ['kyc'])).toBe(false);
    expect(matchesAdminEvent('CASES_EXPORTED', ['case'])).toBe(false);
    expect(matchesAdminEvent('KYC_SUBMITTED', [''])).toBe(false);
  });

  it('hides the Demo item only when demo mode is known to be off', () => {
    expect(adminNav(false).some((i) => i.id === 'demo')).toBe(false);
    expect(adminNav(true).some((i) => i.id === 'demo')).toBe(true);
    expect(adminNav(null).some((i) => i.id === 'demo')).toBe(true);
    expect(adminNav(false)).toHaveLength(12);
  });
});
