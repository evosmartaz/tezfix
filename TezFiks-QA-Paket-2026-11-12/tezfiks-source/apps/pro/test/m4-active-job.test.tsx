import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { router } from 'expo-router';
import path from 'node:path';
import { Linking, Share } from 'react-native';
import * as Location from 'expo-location';
import type { ProAssignment } from '@tezfiks/shared';
import { header, resetApp, clientEmits, emitServerEvent, UUID } from './pro-helpers';
import { assignment, proProfile } from './fixtures';
import { apiError, installPro, ok, on, settle, WORKER_ME } from './m4-helpers';
import { routeAssignment, trackingMode } from '../src/online/tracking';

const APP_DIR = path.join(__dirname, '..', 'src', 'app');
const JOB = UUID(500);

afterEach(() => resetApp());

const minutesFromNow = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

function soloJob(over: Partial<ProAssignment> = {}): ProAssignment {
  return assignment({ id: JOB, acceptedAt: minutesFromNow(-1), freeCancelUntil: minutesFromNow(4), ...over });
}

/** Server-side transition helper: updates the world and answers with the new view. */
function transition(world: { assignments: Record<string, ProAssignment> }, patch: Partial<ProAssignment>) {
  const a = { ...world.assignments[JOB]!, ...patch };
  a.actions = assignment({ status: a.status, ratedCustomer: a.ratedCustomer }).actions;
  world.assignments[JOB] = a;
  return ok(a);
}

describe('active job (board 03 B3) — solo handyman', () => {
  it('shows the timeline, customer, full address and description; en route reports the location every 5 s with the assignment; arrived stops it', async () => {
    const world = installPro({
      assignments: [soloJob()],
      routes: [
        on('POST', `/pro/assignments/${JOB}/en-route`, () => transition(world, { status: 'EN_ROUTE', enRouteAt: new Date().toISOString(), etaSec: 720 })),
        on('POST', `/pro/assignments/${JOB}/arrived`, () =>
          transition(world, { status: 'ARRIVED', arrivedAt: new Date().toISOString(), contactUnlocked: true, chatEnabled: true, customerPhone: '+994501234567' }),
        ),
      ],
    });
    await renderRouter(APP_DIR, { initialUrl: `/job/${JOB}` });
    await waitFor(() => expect(screen.getByTestId('job-full')).toBeTruthy());

    expect(screen.getByText('Aktiv sifariş #2847')).toBeTruthy();
    expect(screen.getByTestId('job-timeline-accepted').props.accessibilityState).toEqual({ checked: true });
    expect(screen.getByTestId('job-timeline-enRoute').props.accessibilityState).toEqual({ checked: false });
    expect(screen.getAllByText('Sifariş qəbul edildi').length).toBe(2); // status badge + timeline step
    expect(screen.getAllByText('Yola çıxdım').length).toBe(2); // timeline step + button
    expect(screen.getByTestId('job-customer-name').props.children).toBe('Nizami T.');
    expect(screen.getByTestId('job-customer-sub').props.children).toBe('★ 4.8');
    expect(screen.getByTestId('job-contact-locked')).toBeTruthy();
    expect(screen.queryByTestId('job-call')).toBeNull();
    expect(screen.getByTestId('job-address').props.children).toBe('Atatürk pr. 45, Nərimanov');
    expect(screen.getByTestId('job-address-details').props.children).toBe('Giriş 2, Mərtəbə 5, Mənzil 12');
    expect(screen.getByTestId('job-description').props.children).toBe('Mətbəxdə kran damcılayır');
    expect(screen.getByTestId('job-fee').props.children).toMatch(/^Platforma haqqı: 10\s₼ · rezerv edilib$/); // UX-P04
    expect(screen.getByTestId('job-cancel-info').props.children).toMatch(/^Pulsuz ləğv: 0[34]:\d\d qalıb$/);
    expect(screen.getByTestId('job-nav')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('job-en-route'));
    await waitFor(() => expect(screen.getByTestId('job-arrived')).toBeTruthy());
    const enRoute = world.calls.find((c) => c.path === `/pro/assignments/${JOB}/en-route`)!;
    expect(enRoute.body).toEqual({ location: { lat: 40.4093, lng: 49.8671 } });
    await waitFor(() => expect(routeAssignment()).toBe(JOB));
    expect(Location.startLocationUpdatesAsync).toHaveBeenLastCalledWith(
      'tezfiks-pro-online-location',
      expect.objectContaining({ timeInterval: 5000, foregroundService: expect.objectContaining({ notificationTitle: 'Yoldasınız' }) }),
    );
    expect(trackingMode()).toBe('service');
    await waitFor(() => expect(clientEmits('pro:location').length).toBeGreaterThan(0));
    expect(clientEmits('pro:location').at(-1)?.[1]).toMatchObject({ lat: 40.4093, lng: 49.8671, assignmentId: JOB });
    expect(screen.getByTestId('job-eta').props.children).toBe('~12 dəq məsafədə');

    await fireEvent.press(screen.getByTestId('job-arrived'));
    // UX review: arriving unlocks the customer's contact, so it is confirmed first (confirm tap added to this flow)
    await waitFor(() => expect(screen.getByTestId('job-arrived-confirm')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('job-arrived-confirm'));
    await waitFor(() => expect(screen.getByTestId('job-complete')).toBeTruthy());
    expect(world.calls.some((c) => c.method === 'POST' && c.path === `/pro/assignments/${JOB}/arrived`)).toBe(true);
    // the pro is offline: route reporting ends with the arrival
    await waitFor(() => expect(routeAssignment()).toBeNull());
    expect(trackingMode()).toBe('none');
    // contact unlocked: phone and chat
    expect(screen.getByTestId('job-call')).toBeTruthy();
    // the number is a readable line of its own (it used to be truncated inside the call button: "Zəng et · 050 1…")
    expect(screen.getByTestId('job-customer-phone').props.children).toBe('050 123 45 67');
    expect(screen.getByText('Zəng et')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('job-call'));
    expect(Linking.openURL).toHaveBeenCalledWith('tel:+994501234567');
    expect(screen.getByTestId('job-chat')).toBeTruthy();
    expect(screen.queryByTestId('job-cancel-section')).toBeNull(); // no provider cancel once arrived
  });

  it('an online pro falls back to 15 s presence pings after arriving', async () => {
    const world = installPro({
      profile: proProfile({ isOnline: true }),
      assignments: [soloJob({ status: 'EN_ROUTE', enRouteAt: new Date().toISOString() })],
      routes: [on('POST', `/pro/assignments/${JOB}/arrived`, () => transition(world, { status: 'ARRIVED', arrivedAt: new Date().toISOString() }))],
    });
    await renderRouter(APP_DIR, { initialUrl: `/job/${JOB}` });
    // an EN_ROUTE job opened after a restart resumes the route reporting
    await waitFor(() => expect(routeAssignment()).toBe(JOB));
    await fireEvent.press(screen.getByTestId('job-arrived'));
    await fireEvent.press(screen.getByTestId('job-arrived-confirm')); // confirmation step (UX review)
    await waitFor(() => expect(routeAssignment()).toBeNull());
    expect(trackingMode()).toBe('service');
    expect(Location.startLocationUpdatesAsync).toHaveBeenLastCalledWith(
      'tezfiks-pro-online-location',
      expect.objectContaining({ timeInterval: 15000, foregroundService: expect.objectContaining({ notificationTitle: 'Siz onlaynsınız' }) }),
    );
  });

  it('"Ünvana çatdım" asks first: "Hələ yox" changes nothing, "Bəli, çatdım" marks the arrival once', async () => {
    const world = installPro({
      assignments: [soloJob({ status: 'EN_ROUTE', enRouteAt: new Date().toISOString() })],
      routes: [
        on('POST', `/pro/assignments/${JOB}/arrived`, () =>
          transition(world, { status: 'ARRIVED', arrivedAt: new Date().toISOString(), contactUnlocked: true, chatEnabled: true, customerPhone: '+994501234567' }),
        ),
      ],
    });
    const arrivals = () => world.calls.filter((c) => c.method === 'POST' && c.path === `/pro/assignments/${JOB}/arrived`);
    await renderRouter(APP_DIR, { initialUrl: `/job/${JOB}` });
    await waitFor(() => expect(screen.getByTestId('job-arrived')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('job-arrived'));
    await waitFor(() => expect(screen.getByTestId('job-arrived-sheet')).toBeTruthy());
    expect(screen.getByText('Ünvana çatdınız?')).toBeTruthy();
    expect(screen.getByText('Müştəriyə bildiriş gedəcək.')).toBeTruthy();
    expect(screen.getByText('Bəli, çatdım')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('job-arrived-keep'));
    await waitFor(() => expect(screen.queryByTestId('job-arrived-sheet')).toBeNull());
    expect(arrivals()).toHaveLength(0);
    expect(screen.getByTestId('job-arrived')).toBeTruthy();
    expect(screen.queryByTestId('job-call')).toBeNull();

    await fireEvent.press(screen.getByTestId('job-arrived'));
    await waitFor(() => expect(screen.getByTestId('job-arrived-confirm')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('job-arrived-confirm'));
    await waitFor(() => expect(screen.getByTestId('job-complete')).toBeTruthy());
    expect(arrivals()).toHaveLength(1);
    expect(screen.queryByTestId('job-arrived-sheet')).toBeNull();
  });

  it.each([
    ['reassigned to another worker (404)', 404, 'NOT_FOUND'],
    ['no longer visible to this pro (403)', 403, 'FORBIDDEN'],
  ])('route reporting stops when the job is %s while the screen is closed', async (_case, status, code) => {
    let gone = false;
    installPro({
      assignments: [soloJob()], // ACCEPTED: reporting runs from the acceptance
      routes: [(c) => (gone && c.method === 'GET' && c.path === `/pro/assignments/${JOB}` ? apiError(status, code) : undefined)],
    });
    await renderRouter(APP_DIR, { initialUrl: `/job/${JOB}` });
    await waitFor(() => expect(routeAssignment()).toBe(JOB));
    await act(async () => {
      router.replace('/profile');
    });
    // a company manager hands the job to someone else: the old worker can no longer read it (the cache still says ACCEPTED)
    gone = true;
    await act(async () => {
      emitServerEvent('assignment:updated', { assignmentId: JOB, requestId: UUID(600), status: 'ACCEPTED' });
    });
    await waitFor(() => expect(routeAssignment()).toBeNull());
    expect(trackingMode()).toBe('none');
  });

  it('a network failure while polling the reported job keeps the route reporting', async () => {
    let failing = false;
    installPro({
      assignments: [soloJob()],
      routes: [(c) => (failing && c.method === 'GET' && c.path === `/pro/assignments/${JOB}` ? apiError(503, 'INTERNAL') : undefined)],
    });
    await renderRouter(APP_DIR, { initialUrl: `/job/${JOB}` });
    await waitFor(() => expect(routeAssignment()).toBe(JOB));
    await act(async () => {
      router.replace('/profile');
    });
    failing = true;
    await act(async () => {
      emitServerEvent('assignment:updated', { assignmentId: JOB, requestId: UUID(600), status: 'ACCEPTED' });
    });
    await settle(100);
    expect(routeAssignment()).toBe(JOB);
  });

  it('route reporting stops when the job is cancelled by the customer while the screen is closed', async () => {
    const world = installPro({ assignments: [soloJob({ status: 'EN_ROUTE', enRouteAt: new Date().toISOString() })] });
    const r = await renderRouter(APP_DIR, { initialUrl: `/job/${JOB}` });
    await waitFor(() => expect(routeAssignment()).toBe(JOB));
    await act(async () => {
      router.replace('/profile');
    });
    world.assignments[JOB] = { ...world.assignments[JOB]!, status: 'CANCELLED_BY_CUSTOMER', cancelledAt: new Date().toISOString() };
    await act(async () => {
      emitServerEvent('assignment:updated', { assignmentId: JOB, requestId: UUID(600), status: 'CANCELLED_BY_CUSTOMER' });
    });
    await waitFor(() => expect(routeAssignment()).toBeNull());
    expect(trackingMode()).toBe('none');
  });

  it('İşi tamamla: keypad labour + materials = total, idempotent submit, then waits for the customer', async () => {
    const world = installPro({
      assignments: [soloJob({ status: 'ARRIVED', arrivedAt: new Date().toISOString() })],
      routes: [
        on('POST', `/pro/assignments/${JOB}/price`, (c) => {
          const b = c.body as { labor: number; materials: number };
          return transition(world, { status: 'PRICE_PROPOSED', priceProposedAt: new Date().toISOString(), price: { ...b, total: b.labor + b.materials } });
        }),
      ],
    });
    const r = await renderRouter(APP_DIR, { initialUrl: `/job/${JOB}` });
    await waitFor(() => expect(screen.getByTestId('job-complete')).toBeTruthy());
    expect(screen.getByText('✓ İşi tamamla')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('job-complete'));
    await waitFor(() => expect(screen.getByTestId('price-screen')).toBeTruthy());
    expect(r.getPathname()).toBe(`/job/${JOB}/price`);
    expect(screen.getByText('İşi tamamla #2847')).toBeTruthy();
    expect(screen.getByText('Qiymət daxil edilmədən sifariş bağlana bilməz. Daxil etdiyiniz məbləğ müştərinin tətbiqində təsdiq üçün göstəriləcək.')).toBeTruthy();

    // a zero total is refused locally
    await fireEvent.press(screen.getByTestId('price-submit'));
    await waitFor(() => expect(screen.getByTestId('price-error')).toBeTruthy());
    expect(screen.getByText('Məbləği daxil edin')).toBeTruthy();
    expect(world.calls.some((c) => c.path.endsWith('/price'))).toBe(false);

    await fireEvent.press(screen.getByTestId('price-keypad-3'));
    await fireEvent.press(screen.getByTestId('price-keypad-5'));
    await fireEvent.press(screen.getByTestId('price-materials'));
    await fireEvent.press(screen.getByTestId('price-keypad-1'));
    await fireEvent.press(screen.getByTestId('price-keypad-0'));
    expect(screen.getByTestId('price-labor-value').props.children).toMatch(/^35,00\s₼$/);
    expect(screen.getByTestId('price-materials-value').props.children).toMatch(/^10,00\s₼$/);
    expect(screen.getByTestId('price-total').props.children).toMatch(/^45,00\s₼$/);

    await fireEvent.press(screen.getByTestId('price-submit'));
    await fireEvent.press(screen.getByTestId('price-confirm-send')); // review step before sending (UX review)
    await waitFor(() => expect(screen.getByTestId('job-state-awaiting-customer')).toBeTruthy());
    const post = world.calls.find((c) => c.method === 'POST' && c.path === `/pro/assignments/${JOB}/price`)!;
    expect(post.body).toEqual({ labor: 3500, materials: 1000 });
    expect(header(post, 'Idempotency-Key')).toBeTruthy();
    expect(screen.getByText('Müştərinin təsdiqi gözlənilir')).toBeTruthy();
    expect(screen.getByTestId('job-price-total').props.children).toMatch(/^45,00\s₼$/);
  });

  it('İşi tamamla retry: the same amount reuses its Idempotency-Key, a corrected amount gets a new one', async () => {
    let failures = 2;
    const world = installPro({
      assignments: [soloJob({ status: 'ARRIVED', arrivedAt: new Date().toISOString() })],
      routes: [
        on('POST', `/pro/assignments/${JOB}/price`, (c) => {
          if (failures-- > 0) return apiError(503, 'INTERNAL');
          const b = c.body as { labor: number; materials: number };
          return transition(world, { status: 'PRICE_PROPOSED', priceProposedAt: new Date().toISOString(), price: { ...b, total: b.labor + b.materials } });
        }),
      ],
    });
    await renderRouter(APP_DIR, { initialUrl: `/job/${JOB}` });
    await waitFor(() => expect(screen.getByTestId('job-complete')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('job-complete'));
    await waitFor(() => expect(screen.getByTestId('price-keypad')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('price-keypad-3'));
    await fireEvent.press(screen.getByTestId('price-keypad-5'));
    const posts = () => world.calls.filter((c) => c.method === 'POST' && c.path === `/pro/assignments/${JOB}/price`);

    // every send now goes through the review step (confirm taps added, UX review)
    await fireEvent.press(screen.getByTestId('price-submit'));
    await fireEvent.press(screen.getByTestId('price-confirm-send'));
    await waitFor(() => expect(posts()).toHaveLength(1));
    await waitFor(() => expect(screen.getByTestId('price-submit')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('price-submit'));
    await fireEvent.press(screen.getByTestId('price-confirm-send'));
    await waitFor(() => expect(posts()).toHaveLength(2));
    expect(header(posts()[1]!, 'Idempotency-Key')).toBe(header(posts()[0]!, 'Idempotency-Key'));

    // the handyman corrects the amount (35 → 350 AZN): a different body must not reuse the key
    await fireEvent.press(screen.getByTestId('price-keypad-0'));
    await fireEvent.press(screen.getByTestId('price-submit'));
    await fireEvent.press(screen.getByTestId('price-confirm-send'));
    await waitFor(() => expect(posts()).toHaveLength(3));
    expect(posts()[2]!.body).toEqual({ labor: 35000, materials: 0 });
    expect(header(posts()[2]!, 'Idempotency-Key')).toBeTruthy();
    expect(header(posts()[2]!, 'Idempotency-Key')).not.toBe(header(posts()[0]!, 'Idempotency-Key'));
    await waitFor(() => expect(screen.getByTestId('job-state-awaiting-customer')).toBeTruthy());
  });

  it('İşi tamamla shows the total for review before sending; "Düzəlt" returns to the keypad and sends nothing', async () => {
    const world = installPro({
      assignments: [soloJob({ status: 'ARRIVED', arrivedAt: new Date().toISOString() })],
      routes: [
        on('POST', `/pro/assignments/${JOB}/price`, (c) => {
          const b = c.body as { labor: number; materials: number };
          return transition(world, { status: 'PRICE_PROPOSED', priceProposedAt: new Date().toISOString(), price: { ...b, total: b.labor + b.materials } });
        }),
      ],
    });
    const posts = () => world.calls.filter((c) => c.method === 'POST' && c.path === `/pro/assignments/${JOB}/price`);
    await renderRouter(APP_DIR, { initialUrl: `/job/${JOB}` });
    await waitFor(() => expect(screen.getByTestId('job-complete')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('job-complete'));
    await waitFor(() => expect(screen.getByTestId('price-keypad')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('price-keypad-3'));
    await fireEvent.press(screen.getByTestId('price-keypad-5'));
    await fireEvent.press(screen.getByTestId('price-materials'));
    await fireEvent.press(screen.getByTestId('price-keypad-1'));
    await fireEvent.press(screen.getByTestId('price-keypad-0'));

    await fireEvent.press(screen.getByTestId('price-submit'));
    await waitFor(() => expect(screen.getByTestId('price-confirm-sheet')).toBeTruthy());
    expect(screen.getByTestId('price-confirm-body').props.children).toMatch(
      /^Müştəriyə 45,00\s₼ göndərilsin\? \(İş haqqı 35,00\s₼ \+ material 10,00\s₼\)\. Göndərildikdən sonra dəyişmək olmur\.$/,
    );
    expect(posts()).toHaveLength(0);

    await fireEvent.press(screen.getByTestId('price-confirm-edit'));
    await waitFor(() => expect(screen.queryByTestId('price-confirm-sheet')).toBeNull());
    expect(posts()).toHaveLength(0);
    await fireEvent.press(screen.getByTestId('price-keypad-0')); // materials 10 → 100 AZN
    await fireEvent.press(screen.getByTestId('price-submit'));
    await waitFor(() => expect(screen.getByTestId('price-confirm-body').props.children).toMatch(/^Müştəriyə 135,00\s₼ göndərilsin\?/));
    await fireEvent.press(screen.getByTestId('price-confirm-send'));
    await waitFor(() => expect(screen.getByTestId('job-state-awaiting-customer')).toBeTruthy());
    expect(posts()).toHaveLength(1);
    expect(posts()[0]!.body).toEqual({ labor: 3500, materials: 10000 });
  });

  it('provider cancel inside the free window: confirmation explains the fee is returned; sends the reason with an idempotency key', async () => {
    const world = installPro({
      assignments: [soloJob()],
      routes: [on('POST', `/pro/assignments/${JOB}/cancel`, () => transition(world, { status: 'CANCELLED_FREE', cancelledAt: new Date().toISOString(), cancelledBy: 'PROVIDER' }))],
    });
    await renderRouter(APP_DIR, { initialUrl: `/job/${JOB}` });
    await waitFor(() => expect(screen.getByTestId('job-cancel')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('job-cancel'));
    await waitFor(() => expect(screen.getByTestId('job-cancel-body')).toBeTruthy());
    expect(screen.getByText('Hələ pulsuz ləğv müddətindəsiniz: platforma haqqı geri qaytarılacaq.')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('job-cancel-reason'), 'Maşın xarab oldu');
    await fireEvent.press(screen.getByTestId('job-cancel-confirm'));
    await waitFor(() => expect(screen.getByTestId('job-state-cancelled')).toBeTruthy());
    const post = world.calls.find((c) => c.path === `/pro/assignments/${JOB}/cancel`)!;
    expect(post.body).toEqual({ reason: 'Maşın xarab oldu' });
    expect(header(post, 'Idempotency-Key')).toBeTruthy();
    expect(screen.getByText('Sifariş ləğv edildi')).toBeTruthy();
  });

  it('after the free window the cancel warns about the kept fee and the strike', async () => {
    installPro({ assignments: [soloJob({ acceptedAt: minutesFromNow(-10), freeCancelUntil: minutesFromNow(-5) })] });
    await renderRouter(APP_DIR, { initialUrl: `/job/${JOB}` });
    await waitFor(() => expect(screen.getByTestId('job-cancel-info')).toBeTruthy());
    expect(screen.getByText('Pulsuz ləğv müddəti bitib: platforma haqqı qaytarılmır və xəbərdarlıq (strike) yazılır')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('job-cancel'));
    await waitFor(() => expect(screen.getByTestId('job-cancel-body')).toBeTruthy());
    expect(screen.getByTestId('job-cancel-body').props.children).toMatch(/strike/);
  });

  it('an action on a job that moved on refreshes it (INVALID_STATE)', async () => {
    const world = installPro({
      assignments: [soloJob()],
      routes: [
        on('POST', `/pro/assignments/${JOB}/en-route`, () => {
          world.assignments[JOB] = { ...world.assignments[JOB]!, status: 'CANCELLED_BY_CUSTOMER', cancelledAt: new Date().toISOString() };
          return apiError(409, 'INVALID_STATE');
        }),
      ],
    });
    await renderRouter(APP_DIR, { initialUrl: `/job/${JOB}` });
    await waitFor(() => expect(screen.getByTestId('job-en-route')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('job-en-route'));
    await waitFor(() => expect(screen.getByTestId('job-state-cancelled')).toBeTruthy());
    expect(routeAssignment()).toBeNull();
  });

  it('rates the customer after completion (once)', async () => {
    const world = installPro({
      assignments: [
        soloJob({
          status: 'COMPLETED',
          enRouteAt: minutesFromNow(-50),
          arrivedAt: minutesFromNow(-40),
          completedAt: minutesFromNow(-1),
          price: { labor: 3500, materials: 1000, total: 4500 },
          paymentMethod: 'CARD',
          tipAmount: 500,
          guaranteeUntil: '2026-11-08T10:00:00.000Z',
          fee: { amount: 1000, captured: true, refunded: false },
        }),
      ],
      routes: [
        on('POST', `/pro/assignments/${JOB}/rate-customer`, () => {
          world.assignments[JOB] = { ...world.assignments[JOB]!, ratedCustomer: true, actions: { ...world.assignments[JOB]!.actions, rateCustomer: false } };
          return ok({ ok: true });
        }),
      ],
    });
    const r = await renderRouter(APP_DIR, { initialUrl: `/job/${JOB}` });
    await waitFor(() => expect(screen.getByTestId('job-rate')).toBeTruthy());
    expect(screen.getByText('Ödəniş: Kartla ödəmə')).toBeTruthy();
    expect(screen.getByText(/^Bəxşiş: 5,00\s₼$/)).toBeTruthy();
    expect(screen.getByText('Zəmanət: 08.11.2026 tarixinədək')).toBeTruthy();
    expect(screen.getByTestId('job-fee').props.children).toMatch(/· tutulub$/);
    await fireEvent.press(screen.getByTestId('job-rate'));
    await waitFor(() => expect(screen.getByTestId('rate-screen')).toBeTruthy());
    expect(screen.getByText('Nizami T. ilə iş necə keçdi?')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('rate-submit'));
    await waitFor(() => expect(screen.getByTestId('rate-error')).toBeTruthy()); // stars required
    await fireEvent.press(screen.getByTestId('rate-stars-5'));
    await fireEvent.changeText(screen.getByTestId('rate-comment'), ' Çox nəzakətli müştəri ');
    await fireEvent.press(screen.getByTestId('rate-submit'));
    await waitFor(() => expect(r.getPathname()).toBe(`/job/${JOB}`));
    const post = world.calls.find((c) => c.path === `/pro/assignments/${JOB}/rate-customer`)!;
    expect(post.body).toEqual({ stars: 5, comment: 'Çox nəzakətli müştəri' });
    await waitFor(() => expect(screen.queryByTestId('job-rate')).toBeNull());
    expect(screen.getByTestId('job-state-done')).toBeTruthy();
  });
});

describe('company worker job (board 04): location only', () => {
  function workerJob(over: Partial<ProAssignment> = {}): ProAssignment {
    // The server sends the WORKER_LIMITED view. The extra fields below simulate a leaky payload: the app must still
    // never render them for a worker (spec 4.4).
    return soloJob({
      view: 'WORKER_LIMITED',
      providerType: 'COMPANY',
      company: { id: UUID(9), name: 'FixPro MMC' },
      requestNumber: 2851,
      category: { id: UUID(701), slug: 'rozetka', name: 'Elektrik — rozetka dəyişimi', icon: null, vertical: 'HOME' },
      address: { ...assignment().address, formatted: 'Xətai rayonu, Məhəmməd Hadi küç. 12' },
      description: 'GİZLİ TƏSVİR',
      price: { labor: 3500, materials: 1000, total: 4500 },
      fee: { amount: 1000, captured: false, refunded: false },
      customerPhone: '+994501234567',
      contactUnlocked: true,
      chatEnabled: true,
      ...over,
    });
  }
  const workerProfile = (entry: 'WORKER' | 'MANAGER') =>
    proProfile({ kind: 'COMPANY_WORKER', company: { id: UUID(9), name: 'FixPro MMC', finalPriceEntry: entry }, wallet: null, earningsBalance: null });

  it('shows the job location, navigation and "Yola çıxdım" but never description, price, fee, rating, phone or chat', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
    installPro({ me: { handyman: WORKER_ME }, profile: workerProfile('MANAGER'), assignments: [workerJob()] });
    await renderRouter(APP_DIR, { initialUrl: `/job/${JOB}` });
    await waitFor(() => expect(screen.getByTestId('job-limited')).toBeTruthy());
    expect(screen.getByTestId('job-assigned-by').props.children).toBe('Sifariş #2851 • FixPro MMC tərəfindən təyin edildi');
    expect(screen.getByText('Sifariş məkanı')).toBeTruthy();
    expect(screen.getByTestId('job-address').props.children).toBe('Xətai rayonu, Məhəmməd Hadi küç. 12');
    expect(screen.getByTestId('job-category').props.children).toBe('Elektrik — rozetka dəyişimi');
    expect(screen.getByTestId('job-limited-note')).toBeTruthy();
    expect(screen.getByText('Google Maps')).toBeTruthy();
    expect(screen.getByText('Waze')).toBeTruthy();
    expect(screen.getByText('Paylaş')).toBeTruthy();
    expect(screen.getByTestId('job-en-route')).toBeTruthy();
    expect(screen.getByTestId('job-customer-name').props.children).toBe('Nizami T.');

    expect(screen.queryByText('GİZLİ TƏSVİR')).toBeNull();
    expect(screen.queryByTestId('job-description')).toBeNull();
    expect(screen.queryByTestId('job-money')).toBeNull();
    expect(screen.queryByTestId('job-price')).toBeNull();
    expect(screen.queryByTestId('job-fee')).toBeNull();
    expect(screen.queryByText(/45,00/)).toBeNull();
    expect(screen.queryByText(/★/)).toBeNull();
    expect(screen.queryByTestId('job-customer-sub')).toBeNull();
    expect(screen.queryByTestId('job-call')).toBeNull();
    expect(screen.queryByTestId('job-chat')).toBeNull();
    expect(screen.queryByText(/994/)).toBeNull();
    expect(screen.queryByTestId('job-cancel')).toBeNull();

    await fireEvent.press(screen.getByTestId('job-nav-share'));
    expect(share).toHaveBeenCalledWith({
      message: 'Aktiv sifariş #2851\nXətai rayonu, Məhəmməd Hadi küç. 12\nhttps://www.google.com/maps/dir/?api=1&destination=40.402,49.871',
    });
    await fireEvent.press(screen.getByTestId('job-nav-waze'));
    expect(Linking.openURL).toHaveBeenCalledWith('https://waze.com/ul?ll=40.402,49.871&navigate=yes');
    await fireEvent.press(screen.getByTestId('job-nav-google'));
    expect(Linking.openURL).toHaveBeenCalledWith('google.navigation:q=40.402,49.871');
    share.mockRestore();
  });

  it('MANAGER-priced company: an arrived worker sees no price step, and the price screen refuses', async () => {
    installPro({ me: { handyman: WORKER_ME }, profile: workerProfile('MANAGER'), assignments: [workerJob({ status: 'ARRIVED', arrivedAt: new Date().toISOString() })] });
    const r = await renderRouter(APP_DIR, { initialUrl: `/job/${JOB}` });
    await waitFor(() => expect(screen.getByTestId('job-state-awaiting-price')).toBeTruthy());
    expect(screen.getByText('Yekun qiyməti idarəedici daxil edəcək')).toBeTruthy();
    expect(screen.queryByTestId('job-complete')).toBeNull();
    await act(async () => {
      router.push(`/job/${JOB}/price`);
    });
    await waitFor(() => expect(screen.getByTestId('price-not-allowed')).toBeTruthy());
    expect(screen.queryByTestId('price-keypad')).toBeNull();
    expect(screen.queryByTestId('price-submit')).toBeNull();
  });

  it('WORKER-priced company: the worker enters the price (and still never sees a price afterwards)', async () => {
    const world = installPro({
      me: { handyman: WORKER_ME },
      profile: workerProfile('WORKER'),
      assignments: [workerJob({ status: 'ARRIVED', arrivedAt: new Date().toISOString() })],
      routes: [
        on('POST', `/pro/assignments/${JOB}/price`, (c) => {
          const b = c.body as { labor: number; materials: number };
          return transition(world, { status: 'PRICE_PROPOSED', price: { ...b, total: b.labor + b.materials } });
        }),
      ],
    });
    await renderRouter(APP_DIR, { initialUrl: `/job/${JOB}` });
    await waitFor(() => expect(screen.getByTestId('job-complete')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('job-complete'));
    await waitFor(() => expect(screen.getByTestId('price-keypad')).toBeTruthy());
    expect(screen.queryByText('Şirkət ustasınızsa və qiyməti idarəedici daxil edirsə, bu ekran sizin üçün göstərilmir.')).toBeNull();
    await fireEvent.press(screen.getByTestId('price-keypad-2'));
    await fireEvent.press(screen.getByTestId('price-keypad-0'));
    await fireEvent.press(screen.getByTestId('price-submit'));
    await fireEvent.press(screen.getByTestId('price-confirm-send')); // review step before sending (UX review)
    await waitFor(() => expect(screen.getByTestId('job-state-awaiting-customer')).toBeTruthy());
    expect(world.calls.find((c) => c.path === `/pro/assignments/${JOB}/price`)!.body).toEqual({ labor: 2000, materials: 0 });
    expect(screen.queryByTestId('job-price')).toBeNull();
    expect(screen.queryByText(/20,00/)).toBeNull();
  });
});

describe('home "Bu gün" for company workers', () => {
  it('hides the earnings tile for a MANAGER-priced company (always 0) and shows it for a WORKER-priced one', async () => {
    installPro({ me: { handyman: WORKER_ME }, profile: proProfile({ kind: 'COMPANY_WORKER', company: { id: UUID(9), name: 'FixPro MMC', finalPriceEntry: 'MANAGER' }, wallet: null }) });
    await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(screen.getByTestId('stat-jobs')).toBeTruthy());
    expect(screen.queryByTestId('stat-earnings')).toBeNull();
    expect(screen.queryByTestId('stat-fees')).toBeNull();
  });

  it('keeps the earnings tile when workers enter prices', async () => {
    installPro({ me: { handyman: WORKER_ME }, profile: proProfile({ kind: 'COMPANY_WORKER', company: { id: UUID(9), name: 'FixPro MMC', finalPriceEntry: 'WORKER' }, wallet: null }) });
    await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(screen.getByTestId('stat-earnings')).toBeTruthy());
    expect(screen.queryByTestId('stat-fees')).toBeNull();
  });

  it('a running job is one tap away from home', async () => {
    installPro({ assignments: [soloJob({ status: 'EN_ROUTE', enRouteAt: new Date().toISOString() })] });
    const r = await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(screen.getByTestId('home-active-job')).toBeTruthy());
    expect(screen.getByText('Usta yolda')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('home-active-job'));
    await waitFor(() => expect(r.getPathname()).toBe(`/job/${JOB}`));
  });
});

describe('route tracking robustness', () => {
  it('"Yola çıxdım" without location permission still moves the job but tells the pro the customer will not see them', async () => {
    (Location.getForegroundPermissionsAsync as jest.Mock).mockResolvedValueOnce({ granted: false, status: 'denied', canAskAgain: false });
    const world = installPro({
      assignments: [soloJob()],
      routes: [on('POST', `/pro/assignments/${JOB}/en-route`, () => transition(world, { status: 'EN_ROUTE', enRouteAt: new Date().toISOString() }))],
    });
    await renderRouter(APP_DIR, { initialUrl: `/job/${JOB}` });
    await waitFor(() => expect(screen.getByTestId('job-en-route')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('job-en-route'));
    await waitFor(() =>
      expect(screen.getByText('Məkan icazəsi yoxdur: müştəri harada olduğunuzu görməyəcək. Ayarlarda məkan icazəsini verin.')).toBeTruthy(),
    );
    expect(world.calls.some((c) => c.method === 'POST' && c.path === `/pro/assignments/${JOB}/en-route`)).toBe(true);
  });

  it('two overlapping route starts for one job start the service once', async () => {
    const { beginRoute } = require('../src/hooks/useRouteTracking') as typeof import('../src/hooks/useRouteTracking');
    const starts = (Location.startLocationUpdatesAsync as jest.Mock).mock.calls.length;
    const t = (k: string) => k;
    const [a, b] = await Promise.all([beginRoute(JOB, t), beginRoute(JOB, t)]);
    expect([a, b]).toEqual([true, true]);
    expect((Location.startLocationUpdatesAsync as jest.Mock).mock.calls.length - starts).toBe(1);
    expect(routeAssignment()).toBe(JOB);
  });

  it('overlapping starts and a stop leave no ticker or watch behind', async () => {
    const tracking = require('../src/online/tracking') as typeof import('../src/online/tracking');
    const baseline = jest.getTimerCount();
    (Location.startLocationUpdatesAsync as jest.Mock).mockRejectedValueOnce(new Error('no service')).mockRejectedValueOnce(new Error('no service'));
    const removes: jest.Mock[] = [];
    (Location.watchPositionAsync as jest.Mock).mockImplementation(async () => {
      const remove = jest.fn();
      removes.push(remove);
      return { remove };
    });
    try {
      const n = { title: 'x', body: 'y' };
      await Promise.all([tracking.startRouteTracking(JOB, n), tracking.startOnlineTracking(n)]);
      expect(tracking.trackingMode()).toBe('watch');
      expect(jest.getTimerCount()).toBe(baseline + 1); // exactly one 1 s ticker
      await tracking.stopOnlineTracking();
      expect(jest.getTimerCount()).toBe(baseline);
      expect(removes).toHaveLength(2);
      for (const r of removes) expect(r).toHaveBeenCalled();
    } finally {
      (Location.watchPositionAsync as jest.Mock).mockImplementation(async () => ({ remove: jest.fn() }));
    }
  });
});
