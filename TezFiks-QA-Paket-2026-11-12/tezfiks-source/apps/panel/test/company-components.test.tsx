// @vitest-environment jsdom
/**
 * Company panel client components (lane P2): the dispatch board's live offers (socket offer:new / offer:closed),
 * the worker picker and accept/decline with idempotency keys, manager price entry, top-up in a new tab, settings,
 * quote fee preview, invites and live refresh filtering.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderPanel } from './render';
import { CID, OTHER_CID, PID, assignment, candidate, companyView, invite, offer, providerProject, wallet } from './company-fixtures';

const actions = vi.hoisted(() => ({
  acceptOfferAction: vi.fn(),
  declineOfferAction: vi.fn(),
  companyOffersAction: vi.fn(),
  activeAssignmentsAction: vi.fn(),
  workersLiveAction: vi.fn(),
  listAssignmentsAction: vi.fn(),
  enterPriceAction: vi.fn(),
  reassignAction: vi.fn(),
  cancelAssignmentAction: vi.fn(),
  updateMemberAction: vi.fn(),
  removeMemberAction: vi.fn(),
  createInviteAction: vi.fn(),
  revokeInviteAction: vi.fn(),
  listTransactionsAction: vi.fn(),
  topupAction: vi.fn(),
  setPayoutMethodAction: vi.fn(),
  updateSettingsAction: vi.fn(),
  submitQuoteAction: vi.fn(),
  withdrawQuoteAction: vi.fn(),
  addReportAction: vi.fn(),
  completeProjectAction: vi.fn(),
}));
vi.mock('@/features/company/actions', () => actions);

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/company' }));

const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('@/components/toaster', () => ({ toast: toastMock, Toaster: () => null }));

// Fake realtime: components subscribe through useSocketEvent; tests emit server events.
const socket = vi.hoisted(() => {
  const handlers = new Map<string, Set<(p: unknown) => void>>();
  return {
    handlers,
    connected: true,
    epoch: 1,
    emit(event: string, payload: unknown) {
      for (const h of handlers.get(event) ?? []) h(payload);
    },
  };
});
vi.mock('@/lib/realtime/realtime-provider', async () => {
  const React = await import('react');
  return {
    useRealtime: () => ({ socket: null, connected: socket.connected, connectionEpoch: socket.epoch }),
    useSocketEvent: (event: string, handler: (p: unknown) => void) => {
      const ref = React.useRef(handler);
      ref.current = handler;
      React.useEffect(() => {
        const fn = (p: unknown) => ref.current(p);
        if (!socket.handlers.has(event)) socket.handlers.set(event, new Set());
        socket.handlers.get(event)!.add(fn);
        return () => {
          socket.handlers.get(event)!.delete(fn);
        };
      }, [event]);
    },
  };
});

vi.mock('@/components/map/panel-map', () => ({
  BAKU_CENTER: { lat: 40.4093, lng: 49.8671 },
  PanelMap: (props: { markers?: Array<{ id: string }>; onMapClick?: (p: { lat: number; lng: number }) => void }) => (
    <div data-testid="map" data-markers={props.markers?.length ?? 0}>
      {props.onMapClick ? (
        <button type="button" onClick={() => props.onMapClick?.({ lat: 40.38, lng: 49.84 })}>
          map click
        </button>
      ) : null}
    </div>
  ),
}));

import { DispatchBoard, OfferCard } from '@/features/company/components/dispatch-board';
import { PriceDialog } from '@/features/company/components/assignment-actions';
import { TopupForm } from '@/features/company/components/balance-forms';
import { CompanySettingsForm } from '@/features/company/components/settings-form';
import { QuoteFormView } from '@/features/company/components/project-forms';
import { InvitesManager } from '@/features/company/components/workers-manager';
import { CompanyLiveRefresh } from '@/features/company/components/live-refresh';

const NBSP = ' ';

function liveOffer(over: Parameters<typeof offer>[0] = {}) {
  const now = Date.now();
  return offer({ sentAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 29_000).toISOString(), ...over });
}

beforeEach(() => {
  for (const fn of Object.values(actions)) fn.mockReset();
  router.refresh.mockReset();
  toastMock.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
  socket.handlers.clear();
  socket.connected = true;
  socket.epoch = 1;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('OfferCard: worker picker and accept', () => {
  function renderCard(o = liveOffer(), extra: Partial<Parameters<typeof OfferCard>[0]> = {}) {
    const props = {
      companyId: CID,
      offer: o,
      state: { clockOffsetMs: 0 },
      now: Date.now(),
      walletAvailable: 23000,
      onAccepted: vi.fn(),
      onDeclined: vi.fn(),
      onGone: vi.fn(),
      onRefresh: vi.fn(),
      ...extra,
    };
    renderPanel(<OfferCard {...props} />);
    return props;
  }

  it('one open slot: picking another worker replaces the pick; busy workers are disabled', () => {
    renderCard();
    const opts = screen.getAllByRole('option');
    expect(opts[0]!.getAttribute('aria-selected')).toBe('true');
    fireEvent.click(opts[1]!);
    expect(opts[0]!.getAttribute('aria-selected')).toBe('false');
    expect(opts[1]!.getAttribute('aria-selected')).toBe('true');
    expect((opts[2] as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(opts[2]!);
    expect(opts[2]!.getAttribute('aria-selected')).toBe('false');
  });

  it('several open slots: up to slotsOpen workers, the fee note follows the selection', () => {
    renderCard(
      liveOffer({
        slotsOpen: 2,
        slotsRequested: 2,
        candidateWorkers: [candidate(), candidate({ handymanId: PID.tural, firstName: 'Tural', lastName: 'Əliyev' }), candidate({ handymanId: PID.nijat, firstName: 'Nicat', lastName: 'Quliyev', distanceM: 9000 })],
      }),
    );
    const opts = screen.getAllByRole('option');
    fireEvent.click(opts[1]!);
    expect(document.body.textContent).toContain(`Qəbulda şirkət balansından 20${NBSP}₼ tutulacaq`);
    fireEvent.click(opts[2]!);
    expect(screen.getByRole('alert').textContent).toBe('Bu sifariş üçün ən çox 2 usta seçmək olar');
    expect(opts.filter((o) => o.getAttribute('aria-selected') === 'true')).toHaveLength(2);
  });

  it('accepts with the picked workers; a network failure keeps the idempotency key for the retry', async () => {
    const props = renderCard();
    fireEvent.click(screen.getAllByRole('option')[1]!);
    actions.acceptOfferAction.mockResolvedValueOnce({ ok: false, code: 'NETWORK', message: 'İnternet yoxdur' });
    fireEvent.click(screen.getByRole('button', { name: /Qəbul et və göndər/ }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('İnternet yoxdur'));
    actions.acceptOfferAction.mockResolvedValueOnce({ ok: true, data: { assignments: [assignment()] } });
    fireEvent.click(screen.getByRole('button', { name: /Qəbul et və göndər/ }));
    await waitFor(() => expect(props.onAccepted).toHaveBeenCalledWith(props.offer, 1));
    const [first, second] = actions.acceptOfferAction.mock.calls;
    expect(first!.slice(0, 3)).toEqual([CID, PID.offer1, [PID.tural]]);
    expect(second![3]).toBe(first![3]);
    expect(String(first![3]).length).toBeGreaterThanOrEqual(8);
  });

  it('a different selection is a different operation (new key); a refused accept is not retried with the same key', async () => {
    renderCard(liveOffer({ slotsOpen: 2, slotsRequested: 2 }));
    actions.acceptOfferAction.mockResolvedValue({ ok: false, code: 'WORKER_UNAVAILABLE', message: 'Usta məşğuldur' });
    fireEvent.click(screen.getByRole('button', { name: /Qəbul et və göndər/ }));
    await waitFor(() => expect(actions.acceptOfferAction).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getAllByRole('option')[1]!);
    fireEvent.click(screen.getByRole('button', { name: /Qəbul et və göndər/ }));
    await waitFor(() => expect(actions.acceptOfferAction).toHaveBeenCalledTimes(2));
    const keys = actions.acceptOfferAction.mock.calls.map((c) => c[3]);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('an offer taken meanwhile is removed from the board', async () => {
    const props = renderCard();
    actions.acceptOfferAction.mockResolvedValue({ ok: false, code: 'OFFER_UNAVAILABLE', message: 'Artıq götürülüb' });
    fireEvent.click(screen.getByRole('button', { name: /Qəbul et və göndər/ }));
    await waitFor(() => expect(props.onGone).toHaveBeenCalled());
    expect(toastMock.error).toHaveBeenCalledWith('Artıq götürülüb');
  });

  it('declines', async () => {
    const props = renderCard();
    actions.declineOfferAction.mockResolvedValue({ ok: true, data: { ok: true } });
    fireEvent.click(screen.getByRole('button', { name: /İmtina et/ }));
    await waitFor(() => expect(props.onDeclined).toHaveBeenCalled());
    expect(actions.declineOfferAction).toHaveBeenCalledWith(CID, PID.offer1);
  });

  it('accept is disabled when nobody can be sent and warns about a low balance', () => {
    renderCard(liveOffer({ candidateWorkers: [candidate({ busy: true })] }), { walletAvailable: 500 });
    expect((screen.getByRole('button', { name: /Qəbul et və göndər/ }) as HTMLButtonElement).disabled).toBe(true);
    renderCard(liveOffer({ id: PID.offer2 }), { walletAvailable: 500 });
    expect(document.body.textContent).toContain('Şirkət balansı bu sifariş üçün kifayət etmir.');
  });
});

describe('DispatchBoard: live updates', () => {
  function board(initialOffers = { items: [] as ReturnType<typeof offer>[], serverNow: new Date().toISOString() }) {
    return renderPanel(
      <DispatchBoard
        companyId={CID}
        initialOffers={initialOffers}
        initialAssignments={[]}
        initialWorkers={[]}
        wallet={wallet}
      />,
    );
  }

  it('offer:new for this company appears; other companies are ignored; offer:closed removes it with a notice', async () => {
    board();
    expect(screen.queryByTestId('offer-card')).toBeNull();
    act(() => socket.emit('offer:new', liveOffer({ id: PID.offer2, companyId: OTHER_CID })));
    expect(screen.queryByTestId('offer-card')).toBeNull();
    act(() => socket.emit('offer:new', liveOffer()));
    expect(screen.getByTestId('offer-card').getAttribute('data-offer-id')).toBe(PID.offer1);
    act(() => socket.emit('offer:closed', { offerId: PID.offer1, requestId: PID.request1, reason: 'TAKEN' }));
    expect(screen.queryByTestId('offer-card')).toBeNull();
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith('Sifariş #2851 artıq başqası tərəfindən götürüldü'));
  });

  it('expires an offer when its countdown reaches zero', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
    const now = Date.now();
    board({
      items: [offer({ sentAt: new Date(now).toISOString(), expiresAt: new Date(now + 3000).toISOString() })],
      serverNow: new Date(now).toISOString(),
    });
    expect(screen.getByTestId('offer-card')).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(3500);
    });
    expect(screen.queryByTestId('offer-card')).toBeNull();
    expect(toastMock).toHaveBeenCalledWith('Sifariş #2851 üçün vaxt bitdi');
  });

  it('wallet:updated for this company updates the balance chip', () => {
    board();
    expect(screen.getByTestId('wallet-chip').textContent).toBe(`Balans: 230${NBSP}₼`);
    act(() => socket.emit('wallet:updated', { owner: 'company', companyId: OTHER_CID, available: 100, posted: 100 }));
    expect(screen.getByTestId('wallet-chip').textContent).toBe(`Balans: 230${NBSP}₼`);
    act(() => socket.emit('wallet:updated', { owner: 'company', companyId: CID, available: 22000, posted: 23000 }));
    expect(screen.getByTestId('wallet-chip').textContent).toBe(`Balans: 220${NBSP}₼`);
  });

  it('assignment:updated and company:workers refetch the jobs and the worker positions', async () => {
    actions.activeAssignmentsAction.mockResolvedValue({ ok: true, data: { items: [assignment({ status: 'EN_ROUTE', etaSec: 300 })], nextCursor: null } });
    actions.workersLiveAction.mockResolvedValue({ ok: true, data: { items: [] } });
    board();
    act(() => socket.emit('assignment:updated', { assignmentId: PID.asg1, requestId: PID.request1, status: 'EN_ROUTE' }));
    await waitFor(() => expect(document.querySelector('[data-column="EN_ROUTE"]')?.textContent).toContain('#2851'));
    expect(actions.activeAssignmentsAction).toHaveBeenCalledWith(CID);
    actions.workersLiveAction.mockClear();
    act(() => socket.emit('company:workers', { companyId: OTHER_CID }));
    act(() => socket.emit('company:workers', { companyId: CID }));
    await waitFor(() => expect(actions.workersLiveAction).toHaveBeenCalledTimes(1));
  });

  it('shows the polling state without a live connection', () => {
    socket.connected = false;
    board();
    expect(document.body.textContent).toContain('Yenilənir (bağlantı yoxdur)');
  });
});

describe('PriceDialog', () => {
  it('shows the total and posts labor + materials in qəpik', async () => {
    actions.enterPriceAction.mockResolvedValue({ ok: true, data: assignment({ status: 'PRICE_PROPOSED' }) });
    renderPanel(<PriceDialog companyId={CID} assignmentId={PID.asg1} />);
    fireEvent.click(screen.getByRole('button', { name: /Qiyməti daxil et/ }));
    fireEvent.change(await screen.findByLabelText('İş haqqı (₼)'), { target: { value: '40' } });
    fireEvent.change(screen.getByLabelText('Material xərci (₼)'), { target: { value: '15,50' } });
    expect(screen.getByTestId('price-total').textContent).toBe(`55,50${NBSP}₼`);
    fireEvent.click(screen.getByRole('button', { name: /Qiyməti təsdiqlə və işi bitir/ }));
    await waitFor(() => expect(actions.enterPriceAction).toHaveBeenCalled());
    const [cid, aid, body, key] = actions.enterPriceAction.mock.calls[0]!;
    expect([cid, aid, body]).toEqual([CID, PID.asg1, { labor: 4000, materials: 1550 }]);
    expect(typeof key).toBe('string');
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });

  it('refuses an empty labour amount without calling the API', async () => {
    renderPanel(<PriceDialog companyId={CID} assignmentId={PID.asg1} />);
    fireEvent.click(screen.getByRole('button', { name: /Qiyməti daxil et/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Qiyməti təsdiqlə və işi bitir/ }));
    expect(await screen.findByText('İş haqqını düzgün daxil edin')).toBeTruthy();
    expect(actions.enterPriceAction).not.toHaveBeenCalled();
  });
});

describe('TopupForm', () => {
  it('opens the checkout in a new tab', async () => {
    const tab = { location: { href: '' }, opener: {} as unknown, close: vi.fn() };
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    actions.topupAction.mockResolvedValue({ ok: true, data: { paymentIntentId: PID.tx, checkoutUrl: 'https://pay.test/checkout/1' } });
    renderPanel(<TopupForm companyId={CID} />);
    fireEvent.click(screen.getByRole('button', { name: `50${NBSP}₼` }));
    fireEvent.click(screen.getByRole('button', { name: /Ödənişə keç/ }));
    await waitFor(() => expect(tab.location.href).toBe('https://pay.test/checkout/1'));
    expect(open).toHaveBeenCalledWith('', '_blank');
    expect(tab.opener).toBeNull();
    expect(actions.topupAction.mock.calls[0]!.slice(0, 2)).toEqual([CID, 5000]);
    expect(screen.getByRole('link', { name: /Ödəniş səhifəsini aç/ }).getAttribute('href')).toBe('https://pay.test/checkout/1');
  });

  it('validates the amount and closes the blank tab on an API error', async () => {
    const tab = { location: { href: '' }, opener: null, close: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    renderPanel(<TopupForm companyId={CID} />);
    fireEvent.change(screen.getByLabelText('Məbləğ (₼)'), { target: { value: '0,5' } });
    fireEvent.click(screen.getByRole('button', { name: /Ödənişə keç/ }));
    expect(await screen.findByText('1 ilə 1000 ₼ arasında məbləğ daxil edin')).toBeTruthy();
    expect(actions.topupAction).not.toHaveBeenCalled();
    actions.topupAction.mockResolvedValue({ ok: false, code: 'RATE_LIMITED', message: 'Çox sayda cəhd' });
    fireEvent.change(screen.getByLabelText('Məbləğ (₼)'), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: /Ödənişə keç/ }));
    expect(await screen.findByText('Çox sayda cəhd')).toBeTruthy();
    expect(tab.close).toHaveBeenCalled();
  });
});

describe('CompanySettingsForm', () => {
  const options = [{ id: PID.category, name: 'Elektrik', group: 'Ev ustaları' }, { id: PID.category2, name: 'Santexnik', group: 'Ev ustaları' }];

  it('an unchanged form does not call the API', async () => {
    renderPanel(<CompanySettingsForm company={companyView()} tradeOptions={options} />);
    fireEvent.click(screen.getByRole('button', { name: /Yadda saxla/ }));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith('Dəyişiklik yoxdur'));
    expect(actions.updateSettingsAction).not.toHaveBeenCalled();
  });

  it('switching to "Usta özü daxil edir", adding a trade and moving the base sends only those fields', async () => {
    actions.updateSettingsAction.mockResolvedValue({ ok: true, data: companyView({ finalPriceEntry: 'WORKER' }) });
    renderPanel(<CompanySettingsForm company={companyView()} tradeOptions={options} />);
    fireEvent.click(screen.getByRole('radio', { name: /Usta özü daxil edir/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Santexnik' }));
    fireEvent.click(screen.getByRole('button', { name: 'map click' }));
    fireEvent.click(screen.getByRole('button', { name: /Yadda saxla/ }));
    await waitFor(() => expect(actions.updateSettingsAction).toHaveBeenCalled());
    expect(actions.updateSettingsAction.mock.calls[0]).toEqual([
      CID,
      { finalPriceEntry: 'WORKER', tradeIds: [PID.category, PID.category2], base: { lat: 40.38, lng: 49.84 } },
    ]);
  });

  it('marks invalid fields', async () => {
    renderPanel(<CompanySettingsForm company={companyView()} tradeOptions={options} />);
    fireEvent.change(screen.getByLabelText('Xidmət radiusu (km)'), { target: { value: '80' } });
    fireEvent.click(screen.getByRole('button', { name: /Yadda saxla/ }));
    expect(await screen.findByText('Radius 2–50 km olmalıdır')).toBeTruthy();
    expect(actions.updateSettingsAction).not.toHaveBeenCalled();
  });
});

describe('QuoteFormView', () => {
  it('previews the held fee from workers × days and submits as the company', async () => {
    actions.submitQuoteAction.mockResolvedValue({ ok: true, data: {} });
    renderPanel(<QuoteFormView companyId={CID} project={providerProject()} walletAvailable={wallet.available} />);
    const fee = () => screen.getByTestId('quote-fee').textContent ?? '';
    expect(fee()).toContain(`150${NBSP}₼`);
    fireEvent.change(screen.getByLabelText('Usta sayı'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Gün'), { target: { value: '10' } });
    expect(fee()).toContain(`200${NBSP}₼`);
    fireEvent.change(screen.getByLabelText('Ümumi qiymət (₼)'), { target: { value: '4800' } });
    fireEvent.click(screen.getByRole('button', { name: /Təklif göndər/ }));
    await waitFor(() => expect(actions.submitQuoteAction).toHaveBeenCalled());
    expect(actions.submitQuoteAction.mock.calls[0]!.slice(0, 3)).toEqual([
      CID,
      PID.project,
      { companyId: CID, totalAmount: 480000, workers: 2, days: 10 },
    ]);
  });

  it('warns when the wallet cannot cover the fee', () => {
    renderPanel(<QuoteFormView companyId={CID} project={providerProject()} walletAvailable={1000} />);
    expect(document.body.textContent).toContain('Şirkət balansı bu təklifin haqqı üçün kifayət etmir.');
  });
});

describe('InvitesManager', () => {
  it('creates an invite and shows its link', async () => {
    actions.createInviteAction.mockResolvedValue({ ok: true, data: invite });
    renderPanel(<InvitesManager companyId={CID} invites={[]} nowMs={Date.parse('2026-10-26T00:00:00.000Z')} />);
    fireEvent.click(screen.getByRole('button', { name: /Dəvət linki yarat/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Yarat' }));
    await waitFor(() => expect(actions.createInviteAction).toHaveBeenCalledWith(CID, { role: 'WORKER', maxUses: 10, expiresInDays: 7 }));
    expect(((await screen.findByLabelText('Link')) as HTMLInputElement).value).toBe(invite.url);
  });

  it('lists invites with their state and copy / revoke actions', () => {
    renderPanel(
      <InvitesManager
        companyId={CID}
        invites={[invite, { ...invite, id: PID.tx, revokedAt: '2026-10-25T12:00:00.000Z' }]}
        nowMs={Date.parse('2026-10-26T00:00:00.000Z')}
      />,
    );
    const active = document.querySelector(`[data-invite-id="${PID.invite}"]`) as HTMLElement;
    expect(active.textContent).toContain('Aktiv');
    expect(within(active).getByRole('button', { name: /Kopyala/ })).toBeTruthy();
    const revoked = document.querySelector(`[data-invite-id="${PID.tx}"]`) as HTMLElement;
    expect(revoked.textContent).toContain('Ləğv edilib');
    expect(within(revoked).queryByRole('button', { name: /Kopyala/ })).toBeNull();
  });
});

describe('CompanyLiveRefresh', () => {
  it('refreshes for this company events only (debounced)', async () => {
    vi.useFakeTimers();
    renderPanel(<CompanyLiveRefresh companyId={CID} topics={['workers', 'wallet']} debounceMs={100} />);
    act(() => socket.emit('company:workers', { companyId: OTHER_CID }));
    act(() => socket.emit('wallet:updated', { owner: 'company', companyId: OTHER_CID, available: 1, posted: 1 }));
    act(() => socket.emit('assignment:updated', { assignmentId: PID.asg1, requestId: PID.request1, status: 'EN_ROUTE' }));
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(router.refresh).not.toHaveBeenCalled();
    act(() => socket.emit('company:workers', { companyId: CID }));
    act(() => socket.emit('wallet:updated', { owner: 'company', companyId: CID, available: 1, posted: 1 }));
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });
});
