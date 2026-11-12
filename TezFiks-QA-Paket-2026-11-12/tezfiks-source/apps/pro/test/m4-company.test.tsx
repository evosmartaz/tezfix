import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import path from 'node:path';
import { Share } from 'react-native';
import type { OfferView, ProAssignment } from '@tezfiks/shared';
import { emitServerEvent, header, resetApp, UUID } from './pro-helpers';
import { assignment, candidate, companyView, member, offer } from './fixtures';
import { apiError, installPro, ok, on } from './m4-helpers';

const APP_DIR = path.join(__dirname, '..', 'src', 'app');
const CID = UUID(9);
const MANAGED = [{ id: CID, name: 'FixPro MMC', status: 'APPROVED' as const, role: 'MANAGER' as const }];
const MANAGER_ME = { handyman: null, companies: [{ companyId: CID, companyName: 'FixPro MMC', role: 'MANAGER', companyStatus: 'APPROVED' }] };

afterEach(() => resetApp());

function companyOffer(over: Partial<OfferView> = {}): OfferView {
  const now = Date.now();
  return offer({
    id: UUID(4001),
    requestNumber: 2851,
    target: 'COMPANY',
    companyId: CID,
    sentAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 30_000).toISOString(),
    category: { id: UUID(701), slug: 'rozetka', name: 'Elektrik — rozetka dəyişimi', icon: null, vertical: 'HOME' },
    descriptionShort: '',
    address: { district: 'Xətai', street: 'M.Hadi küç.', area: 'Xətai r., M.Hadi küç. 12', lat: 40.38, lng: 49.9 },
    customer: { firstName: 'Aysel', lastInitial: 'Q', ratingAvg: 4.8, ratingCount: 3, type: 'INDIVIDUAL', companyName: null },
    candidateWorkers: [
      candidate(1, { firstName: 'Rauf', lastName: 'Hüseynov', ratingAvg: 4.7, distanceM: 1800 }),
      candidate(2, { firstName: 'Tural', lastName: 'Əliyev', ratingAvg: 4.5, distanceM: 3200 }),
      candidate(3, { firstName: 'Kamran', lastName: 'Səfərov', ratingAvg: 4.8, distanceM: 5100, busy: true }),
    ],
    ...over,
  });
}

function dashboard() {
  return { jobsToday: 4, activeJobs: 2, onlineWorkers: 2, membersCount: 3, wallet: companyView().wallet, earningsBalance: 50000, feesToday: 4000, revenueToday: 18000 };
}

function managerRoutes(state: { offers: OfferView[] }, extra: Parameters<typeof installPro>[0]['routes'] = []) {
  return [
    ...(extra ?? []),
    on('GET', `/company/${CID}`, () => ok(companyView())),
    on('GET', `/company/${CID}/dashboard`, () => ok(dashboard())),
    on('GET', `/company/${CID}/offers/current`, () => ok({ items: state.offers, serverNow: new Date().toISOString() })),
  ];
}

describe('manager mode home (board 04)', () => {
  it('shows the balance chip, today numbers and an incoming order without phone or flat details', async () => {
    const state = { offers: [companyOffer()] };
    installPro({ me: MANAGER_ME, profile: null, managedCompanies: MANAGED, routes: managerRoutes(state) });
    await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(screen.getByTestId('home-company-mode')).toBeTruthy());
    expect(screen.getByText('FixPro MMC — İdarəedici')).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/^Balans: 240\s₼$/)).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId('company-stat-jobs')).toBeTruthy());
    expect(screen.getByText(/^180\s₼$/)).toBeTruthy();

    await waitFor(() => expect(screen.getByTestId(`company-offer-${UUID(4001)}`)).toBeTruthy());
    expect(screen.getByText('Yeni sifariş #2851')).toBeTruthy();
    expect(screen.getByTestId(`company-offer-area-${UUID(4001)}`).props.children).toBe('Xətai r., M.Hadi küç. 12');
    expect(screen.getByText('Qəbulda şirkət balansından 10 AZN tutulacaq')).toBeTruthy();
    expect(screen.getByText('Ustanı seçin')).toBeTruthy();
    expect(screen.queryByText(/\+994/)).toBeNull();
    // Boşdur / Sifarişdədir with rating and distance; the busy worker cannot be picked
    expect(screen.getAllByText('Boşdur')).toHaveLength(2);
    expect(screen.getByText('Sifarişdədir')).toBeTruthy();
    expect(screen.getByText('★ 4.7 • 1,8 km')).toBeTruthy();
    expect(screen.getByTestId(`pick-worker-${UUID(103)}`).props.accessibilityState).toMatchObject({ disabled: true, checked: false });
    // nearest free worker is preselected
    expect(screen.getByTestId(`pick-worker-${UUID(101)}`).props.accessibilityState).toMatchObject({ checked: true });
  });

  it('"Qəbul et və göndər" sends the picked worker with an idempotency key and removes the card', async () => {
    const state = { offers: [companyOffer()] };
    const accepted: unknown[] = [];
    const world = installPro({
      me: MANAGER_ME,
      profile: null,
      managedCompanies: MANAGED,
      routes: managerRoutes(state, [
        on('POST', `/company/${CID}/offers/${UUID(4001)}/accept`, (c) => {
          accepted.push(c.body);
          state.offers = [];
          return ok({ assignments: [assignment({ providerType: 'COMPANY', company: { id: CID, name: 'FixPro MMC' } })] });
        }),
      ]),
    });
    await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(screen.getByTestId(`company-offer-${UUID(4001)}`)).toBeTruthy());
    // single slot: picking Tural swaps the selection; Kamran (busy) stays unselectable
    await fireEvent.press(screen.getByTestId(`pick-worker-${UUID(102)}`));
    await fireEvent.press(screen.getByTestId(`pick-worker-${UUID(103)}`));
    expect(screen.getByTestId(`pick-worker-${UUID(102)}`).props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByTestId(`pick-worker-${UUID(101)}`).props.accessibilityState).toMatchObject({ checked: false });
    await fireEvent.press(screen.getByTestId(`company-offer-accept-${UUID(4001)}`));
    await waitFor(() => expect(screen.getByText('Sifariş ustaya göndərildi')).toBeTruthy());
    expect(accepted).toEqual([{ workerIds: [UUID(102)] }]);
    expect(header(world.calls.find((c) => c.path.endsWith('/accept'))!, 'Idempotency-Key')).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId(`company-offer-${UUID(4001)}`)).toBeNull());
  });

  it('multi-slot offers allow one worker per open slot and warn per worker', async () => {
    const state = { offers: [companyOffer({ slotsOpen: 2, slotsRequested: 2 })] };
    installPro({ me: MANAGER_ME, profile: null, managedCompanies: MANAGED, routes: managerRoutes(state) });
    await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(screen.getByTestId(`company-offer-${UUID(4001)}`)).toBeTruthy());
    expect(screen.getByText('Qəbulda şirkət balansından hər usta üçün 10 AZN tutulacaq')).toBeTruthy();
    expect(screen.getByText('Ustaları seçin (2/2)')).toBeTruthy();
  });

  it('a worker who became busy keeps the card and refreshes; decline tells the server; offer:closed removes a card', async () => {
    const state = { offers: [companyOffer(), companyOffer({ id: UUID(4002), requestNumber: 2852 })] };
    const world = installPro({
      me: MANAGER_ME,
      profile: null,
      managedCompanies: MANAGED,
      routes: managerRoutes(state, [
        on('POST', `/company/${CID}/offers/${UUID(4001)}/accept`, () => apiError(409, 'WORKER_UNAVAILABLE', { reason: 'BUSY' })),
        on('POST', `/company/${CID}/offers/${UUID(4001)}/decline`, () => ok({ ok: true })),
      ]),
    });
    await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(screen.getByTestId(`company-offer-${UUID(4002)}`)).toBeTruthy());
    await fireEvent.press(screen.getByTestId(`company-offer-accept-${UUID(4001)}`));
    await waitFor(() => expect(screen.getByText('Seçilmiş usta artıq boş deyil')).toBeTruthy());
    expect(screen.getByTestId(`company-offer-${UUID(4001)}`)).toBeTruthy();

    await fireEvent.press(screen.getByTestId(`company-offer-decline-${UUID(4001)}`));
    await waitFor(() => expect(world.calls.some((c) => c.path === `/company/${CID}/offers/${UUID(4001)}/decline`)).toBe(true));
    expect(screen.queryByTestId(`company-offer-${UUID(4001)}`)).toBeNull();

    state.offers = [state.offers[1]!];
    await act(async () => {
      emitServerEvent('offer:closed', { offerId: UUID(4002), requestId: UUID(600), reason: 'TAKEN' });
    });
    await waitFor(() => expect(screen.queryByTestId(`company-offer-${UUID(4002)}`)).toBeNull());
  });
});

describe('manager screens', () => {
  it('settings "Yekun qiyməti kim daxil edir?" saves the choice', async () => {
    let entry: 'WORKER' | 'MANAGER' = 'WORKER';
    const world = installPro({
      me: MANAGER_ME,
      profile: null,
      managedCompanies: MANAGED,
      routes: [
        on('PATCH', `/company/${CID}/settings`, (c) => {
          entry = (c.body as { finalPriceEntry: 'WORKER' | 'MANAGER' }).finalPriceEntry;
          return ok(companyView({ finalPriceEntry: entry }));
        }),
        on('GET', `/company/${CID}`, () => ok(companyView({ finalPriceEntry: entry }))),
      ],
    });
    await renderRouter(APP_DIR, { initialUrl: `/company/${CID}/settings` });
    await waitFor(() => expect(screen.getByText('Yekun qiyməti kim daxil edir?')).toBeTruthy());
    expect(screen.getByText('Usta özü daxil edir')).toBeTruthy();
    expect(screen.getByText('İdarəedici daxil edir')).toBeTruthy();
    expect(screen.getByText('Necə işləyir')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('price-entry-MANAGER'));
    await fireEvent.press(screen.getByTestId('company-settings-save'));
    await waitFor(() => expect(screen.getByText('Tənzimləmələr saxlanıldı')).toBeTruthy());
    expect(world.calls.find((c) => c.method === 'PATCH')!.body).toEqual({ finalPriceEntry: 'MANAGER' });
  });

  it('invite expiry is judged by the server clock, not a wrong device clock', async () => {
    const { clockStore } = require('@tezfiks/mobile') as typeof import('@tezfiks/mobile');
    const base = { token: 'tok_abcdefghijkl', url: 'https://evosmart.az/tezfix/join/tok_abcdefghijkl', role: 'WORKER', maxUses: 10, usedCount: 0, revokedAt: null, createdAt: new Date().toISOString() };
    // The device clock runs 3 h fast: the server's "now" is 3 h behind Date.now().
    clockStore.getState().syncWithServer(new Date(Date.now() - 3 * 3_600_000).toISOString());
    const invites = [
      // 1 h in the device's past but 2 h in the server's future: still live
      { ...base, id: UUID(6101), expiresAt: new Date(Date.now() - 3_600_000).toISOString() },
      // 4 h in the device's past, 1 h in the server's past: expired
      { ...base, id: UUID(6102), expiresAt: new Date(Date.now() - 4 * 3_600_000).toISOString() },
    ];
    installPro({
      me: MANAGER_ME,
      profile: null,
      managedCompanies: MANAGED,
      routes: [
        on('GET', `/company/${CID}`, () => ok(companyView())),
        on('GET', `/company/${CID}/members`, () => ok({ items: [member(1)] })),
        on('GET', `/company/${CID}/invites`, () => ok({ items: invites })),
      ],
    });
    await renderRouter(APP_DIR, { initialUrl: `/company/${CID}/members` });
    await waitFor(() => expect(screen.getByTestId(`invite-${UUID(6101)}`)).toBeTruthy());
    expect(screen.queryByTestId(`invite-${UUID(6102)}`)).toBeNull();
  });

  it('members and invite links: create, share (Share.share), revoke, remove a worker', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
    const invite = {
      id: UUID(6001),
      token: 'tok_abcdefghijkl',
      url: 'https://evosmart.az/tezfix/join/tok_abcdefghijkl',
      role: 'WORKER',
      expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      maxUses: 10,
      usedCount: 1,
      revokedAt: null,
      createdAt: new Date().toISOString(),
    };
    let invites: unknown[] = [];
    let members = [member(1, { firstName: 'Rauf', lastName: 'Hüseynov' }), member(2, { firstName: 'Kamran', lastName: 'Səfərov', busy: true }), member(3, { role: 'MANAGER', handymanId: null })];
    const world = installPro({
      me: MANAGER_ME,
      profile: null,
      managedCompanies: MANAGED,
      routes: [
        on('GET', `/company/${CID}`, () => ok(companyView())),
        on('GET', `/company/${CID}/members`, () => ok({ items: members })),
        on('GET', `/company/${CID}/invites`, () => ok({ items: invites })),
        on('POST', `/company/${CID}/invites`, () => {
          invites = [invite];
          return ok(invite);
        }),
        on('DELETE', `/company/${CID}/invites/${UUID(6001)}`, () => {
          invites = [{ ...invite, revokedAt: new Date().toISOString() }];
          return ok({ ok: true });
        }),
        on('DELETE', /^\/company\/[^/]+\/members\/([^/]+)$/, (_c, m) => {
          members = members.filter((x) => x.userId !== m![1]);
          return ok({ ok: true });
        }),
      ],
    });
    await renderRouter(APP_DIR, { initialUrl: `/company/${CID}/members` });
    await waitFor(() => expect(screen.getByTestId(`member-${UUID(201)}`)).toBeTruthy());
    expect(screen.getByText('Sifarişdədir')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('invites-empty')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('invite-create-worker'));
    await waitFor(() => expect(share).toHaveBeenCalledWith({ message: 'FixPro MMC şirkətinə TezFiks Usta tətbiqində qoşulun: https://evosmart.az/tezfix/join/tok_abcdefghijkl' }));
    expect(world.calls.find((c) => c.method === 'POST' && c.path === `/company/${CID}/invites`)!.body).toEqual({ role: 'WORKER', maxUses: 10, expiresInDays: 7 });
    await waitFor(() => expect(screen.getByTestId(`invite-${UUID(6001)}`)).toBeTruthy());
    await fireEvent.press(screen.getByTestId(`invite-revoke-${UUID(6001)}`));
    await waitFor(() => expect(screen.queryByTestId(`invite-${UUID(6001)}`)).toBeNull());

    await fireEvent.press(screen.getByTestId(`member-remove-${UUID(201)}`));
    await waitFor(() => expect(screen.getByTestId('member-remove-confirm')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('member-remove-confirm'));
    await waitFor(() => expect(screen.queryByTestId(`member-${UUID(201)}`)).toBeNull());
    expect(world.calls.some((c) => c.method === 'DELETE' && c.path === `/company/${CID}/members/${UUID(201)}`)).toBe(true);
    share.mockRestore();
  });

  it('company jobs: list in the orders tab, manager price entry and reassign', async () => {
    const JOB = UUID(520);
    let job: ProAssignment = assignment({
      id: JOB,
      providerType: 'COMPANY',
      company: { id: CID, name: 'FixPro MMC' },
      status: 'ARRIVED',
      arrivedAt: new Date().toISOString(),
      worker: { handymanId: UUID(101), userId: UUID(201), firstName: 'Rauf', lastName: 'Hüseynov', photo: null, phone: '+994551112233' },
    });
    const world = installPro({
      me: MANAGER_ME,
      profile: null,
      managedCompanies: MANAGED,
      routes: [
        on('GET', `/company/${CID}`, () => ok(companyView({ finalPriceEntry: 'MANAGER' }))),
        on('GET', `/company/${CID}/dashboard`, () => ok(dashboard())),
        on('GET', `/company/${CID}/offers/current`, () => ok({ items: [], serverNow: new Date().toISOString() })),
        on('GET', `/company/${CID}/assignments`, (_c, _m, q) => ok({ items: q.scope === 'history' ? [] : [job], nextCursor: null })),
        on('GET', `/company/${CID}/assignments/${JOB}`, () => ok(job)),
        on('POST', `/company/${CID}/assignments/${JOB}/price`, (c) => {
          const b = c.body as { labor: number; materials: number };
          job = { ...job, status: 'PRICE_PROPOSED', price: { ...b, total: b.labor + b.materials } };
          return ok(job);
        }),
      ],
    });
    const r = await renderRouter(APP_DIR, { initialUrl: '/orders' });
    await waitFor(() => expect(screen.getByTestId(`order-${JOB}`)).toBeTruthy());
    expect(screen.getByText('Şirkət sifarişləri')).toBeTruthy();
    expect(screen.getByText(/Usta: Rauf Hüseynov/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId(`order-${JOB}`));
    await waitFor(() => expect(r.getPathname()).toBe(`/company/${CID}/jobs/${JOB}`));
    await waitFor(() => expect(screen.getByTestId('job-worker')).toBeTruthy());
    expect(screen.getByTestId('job-worker-call')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Yekun qiyməti daxil et')).toBeTruthy());
    expect(screen.queryByTestId('job-en-route')).toBeNull();

    await fireEvent.press(screen.getByTestId('job-complete'));
    await waitFor(() => expect(screen.getByTestId('price-keypad')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('price-keypad-6'));
    await fireEvent.press(screen.getByTestId('price-keypad-0'));
    await fireEvent.press(screen.getByTestId('price-submit'));
    await fireEvent.press(screen.getByTestId('price-confirm-send')); // review step before sending (UX review)
    await waitFor(() => expect(screen.getByTestId('job-state-awaiting-customer')).toBeTruthy());
    const post = world.calls.find((c) => c.path === `/company/${CID}/assignments/${JOB}/price`)!;
    expect(post.body).toEqual({ labor: 6000, materials: 0 });
    expect(header(post, 'Idempotency-Key')).toBeTruthy();
  });

  it("the manager's chat keeps the company: its back fallback returns to the company job, not /job/<id>", async () => {
    const JOB = UUID(522);
    const job: ProAssignment = assignment({
      id: JOB,
      providerType: 'COMPANY',
      status: 'EN_ROUTE',
      contactUnlocked: true,
      chatEnabled: true,
      customerPhone: '+994501234567',
      company: { id: CID, name: 'FixPro MMC' },
      worker: { handymanId: UUID(101), userId: UUID(201), firstName: 'Rauf', lastName: 'Hüseynov', photo: null, phone: '+994551112233' },
    });
    const world = installPro({
      me: MANAGER_ME,
      profile: null,
      managedCompanies: MANAGED,
      routes: [
        on('GET', `/company/${CID}`, () => ok(companyView())),
        on('GET', `/company/${CID}/assignments/${JOB}`, () => ok(job)),
        on('GET', `/assignments/${JOB}/messages`, () => ok({ items: [], nextCursor: null })),
        on('POST', `/assignments/${JOB}/messages/read`, () => ok({ ok: true })),
      ],
    });
    const r = await renderRouter(APP_DIR, { initialUrl: `/company/${CID}/jobs/${JOB}` });
    await waitFor(() => expect(screen.getByTestId('job-chat')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('job-chat'));
    await waitFor(() => expect(r.getPathname()).toBe(`/job/${JOB}/chat`));
    expect(r.getSearchParams()).toEqual(expect.objectContaining({ companyId: CID }));

    await fireEvent.press(screen.getByTestId('header-back'));
    await waitFor(() => expect(r.getPathname()).toBe(`/company/${CID}/jobs/${JOB}`));
    expect(world.calls.some((c) => c.method === 'GET' && c.path.startsWith(`/pro/assignments/${JOB}`))).toBe(false);
  });

  it("a manager's chat opened without history goes back to the company job, not /job/<id>", async () => {
    const JOB = UUID(523);
    const job: ProAssignment = assignment({
      id: JOB,
      providerType: 'COMPANY',
      status: 'EN_ROUTE',
      contactUnlocked: true,
      chatEnabled: true,
      company: { id: CID, name: 'FixPro MMC' },
      worker: { handymanId: UUID(101), userId: UUID(201), firstName: 'Rauf', lastName: 'Hüseynov', photo: null, phone: '+994551112233' },
    });
    const world = installPro({
      me: MANAGER_ME,
      profile: null,
      managedCompanies: MANAGED,
      routes: [
        on('GET', `/company/${CID}`, () => ok(companyView())),
        on('GET', `/company/${CID}/assignments/${JOB}`, () => ok(job)),
        on('GET', `/assignments/${JOB}/messages`, () => ok({ items: [], nextCursor: null })),
        on('POST', `/assignments/${JOB}/messages/read`, () => ok({ ok: true })),
      ],
    });
    const r = await renderRouter(APP_DIR, { initialUrl: `/job/${JOB}/chat?companyId=${CID}` });
    await waitFor(() => expect(screen.getByTestId('header-back')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('header-back'));
    await waitFor(() => expect(r.getPathname()).toBe(`/company/${CID}/jobs/${JOB}`));
    await waitFor(() => expect(screen.getByTestId('job-chat')).toBeTruthy());
    expect(world.calls.some((c) => c.method === 'GET' && c.path.startsWith(`/pro/assignments/${JOB}`))).toBe(false);
  });

  it('reassigns an accepted company job to a free worker', async () => {
    const JOB = UUID(521);
    let job: ProAssignment = assignment({
      id: JOB,
      providerType: 'COMPANY',
      company: { id: CID, name: 'FixPro MMC' },
      worker: { handymanId: UUID(101), userId: UUID(201), firstName: 'Rauf', lastName: 'Hüseynov', photo: null, phone: null },
    });
    const world = installPro({
      me: MANAGER_ME,
      profile: null,
      managedCompanies: MANAGED,
      routes: [
        on('GET', `/company/${CID}`, () => ok(companyView())),
        on('GET', `/company/${CID}/assignments/${JOB}`, () => ok(job)),
        on('GET', `/company/${CID}/members`, () => ok({ items: [member(1), member(2, { firstName: 'Tural' }), member(4, { busy: true })] })),
        on('POST', `/company/${CID}/assignments/${JOB}/reassign`, (c) => {
          job = { ...job, worker: { ...job.worker, handymanId: (c.body as { workerId: string }).workerId, firstName: 'Tural' } };
          return ok(job);
        }),
      ],
    });
    await renderRouter(APP_DIR, { initialUrl: `/company/${CID}/jobs/${JOB}` });
    await waitFor(() => expect(screen.getByTestId('job-reassign')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('job-reassign'));
    await waitFor(() => expect(screen.getByTestId(`reassign-${UUID(102)}`)).toBeTruthy());
    expect(screen.queryByTestId(`reassign-${UUID(101)}`)).toBeNull(); // current worker
    expect(screen.queryByTestId(`reassign-${UUID(104)}`)).toBeNull(); // busy
    await fireEvent.press(screen.getByTestId(`reassign-${UUID(102)}`));
    await waitFor(() => expect(screen.getByText('Usta dəyişdirildi')).toBeTruthy());
    expect(world.calls.find((c) => c.path.endsWith('/reassign'))!.body).toEqual({ workerId: UUID(102) });
  });

  it('company balance in manager mode uses the company wallet and top-up', async () => {
    const world = installPro({
      me: MANAGER_ME,
      profile: null,
      managedCompanies: MANAGED,
      routes: [
        on('GET', `/company/${CID}/wallet`, () => ok(companyView().wallet)),
        on('GET', `/company/${CID}/wallet/transactions`, () => ok({ items: [], nextCursor: null })),
        on('POST', `/company/${CID}/wallet/topup`, () => ok({ paymentIntentId: UUID(7100), checkoutUrl: 'http://10.0.2.2:3000/tezfix/api/pay/checkout/c?t=1' })),
        on('GET', `/payments/${UUID(7100)}`, () => apiError(404, 'NOT_FOUND')),
      ],
    });
    await renderRouter(APP_DIR, { initialUrl: '/balance' });
    await waitFor(() => expect(screen.getByTestId('wallet-available')).toBeTruthy());
    expect(screen.getByText('FixPro MMC balansı')).toBeTruthy();
    expect(screen.getByTestId('wallet-available').props.children).toMatch(/^240,00\s₼$/);
    await fireEvent.press(screen.getByTestId('wallet-topup'));
    await waitFor(() => expect(screen.getByTestId('topup-pay')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('topup-pay'));
    await waitFor(() => expect(world.calls.some((c) => c.path === `/company/${CID}/wallet/topup`)).toBe(true));
    expect(world.calls.find((c) => c.path === `/company/${CID}/wallet/topup`)!.body).toEqual({ amount: 2000, returnUrl: 'tezfiksusta://payment' });
    expect(world.calls.some((c) => c.path.startsWith('/wallet'))).toBe(false);
  });
});
