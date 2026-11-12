/* Regression tests for the M3 review findings (room sharing, focus, polling budgets, guarantee clock, receipts, ...). */
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import path from 'node:path';
import { router } from 'expo-router';
import { clockStore } from '@tezfiks/mobile';
import type { CustomerAssignment } from '@tezfiks/shared';
import { IDS, assignment, detail } from './fixtures';
import { M3, companyQuote, completed, intent, message, priced, project } from './fixtures-m3';
import { fail, flush, lastSocket, ok, on, resetApp, serverEmit, signedInCustomer, type Handler } from './screen-helpers';
import { releaseRoom, retainRoom } from '../src/hooks/useAssignmentLive';
import { markReadLocally, unreadIdsFromOthers, type ChatItem } from '../src/lib/chat';
import { SETTLE_MAX_MS, paymentPollMs, settlePollMs } from '../src/lib/payments';
import { projectGuaranteeOpen } from '../src/lib/projects';

const APP_DIR = path.join(__dirname, '..', 'src', 'app');
const BASE = `/assignment/${IDS.assignment}`;
const arrived = () =>
  assignment({ status: 'ARRIVED', arrivedAt: new Date().toISOString(), contactUnlocked: true, providerPhone: '+994501112233', chatEnabled: true });

function jobSetup(initial: CustomerAssignment, extra: Handler[] = []) {
  const state = { a: initial };
  const api = signedInCustomer({
    extra: [
      ...extra,
      on('GET', '/assignments/:id/messages', () => ok({ items: [message()], nextCursor: null })),
      on('POST', '/assignments/:id/messages/read', () => ok({ ok: true })),
      on('GET', '/assignments/:id', () => ok(state.a)),
      on('GET', '/requests/:id', () => ok(detail({ status: 'IN_PROGRESS', isSearching: false, search: null, assignments: [state.a] }))),
    ],
  });
  return { api, state };
}

const emitted = (event: string) => (lastSocket()?.emit.mock.calls ?? []).filter((c) => c[0] === event && (c[1] as { id?: string }).id === IDS.assignment);

describe('assignment room is shared by the screens of one job', () => {
  it('joins on the first user and leaves after the last one (per socket)', () => {
    const socket = {};
    const other = {};
    expect(retainRoom(socket, 'a1')).toBe(true);
    expect(retainRoom(socket, 'a1')).toBe(false);
    expect(retainRoom(other, 'a1')).toBe(true);
    expect(retainRoom(socket, 'a2')).toBe(true);
    expect(releaseRoom(socket, 'a1')).toBe(false);
    expect(releaseRoom(socket, 'a1')).toBe(true);
    // Unbalanced releases never ask to leave twice.
    expect(releaseRoom(socket, 'a1')).toBe(false);
    expect(releaseRoom(other, 'a1')).toBe(true);
    expect(releaseRoom(socket, 'a2')).toBe(true);
  });

  beforeEach(() => resetApp());

  it('closing the chat keeps the tracking screen in the room', async () => {
    jobSetup(arrived());
    const r = await renderRouter(APP_DIR, { initialUrl: BASE });
    await waitFor(() => expect(screen.getByTestId('tracking-screen')).toBeTruthy());
    await serverEmit('connect', undefined);
    await flush(10);
    expect(emitted('room:join')).toHaveLength(1);

    await fireEvent.press(screen.getByTestId('tracking-chat'));
    await waitFor(() => expect(r.getPathname()).toBe(`${BASE}/chat`));
    await waitFor(() => expect(screen.getByTestId('chat-screen')).toBeTruthy());
    await act(async () => router.back());
    await waitFor(() => expect(r.getPathname()).toBe(BASE));
    await flush(10);
    expect(emitted('room:leave')).toHaveLength(0);
    expect(emitted('room:join')).toHaveLength(1);
  });
});

describe('price proposed while another screen is on top', () => {
  beforeEach(() => resetApp());

  it('does not open the payment over the chat; it opens when the customer returns to tracking', async () => {
    const { state } = jobSetup(arrived());
    const r = await renderRouter(APP_DIR, { initialUrl: BASE });
    await waitFor(() => expect(screen.getByTestId('tracking-screen')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('tracking-chat'));
    await waitFor(() => expect(r.getPathname()).toBe(`${BASE}/chat`));
    await waitFor(() => expect(screen.getByTestId('chat-screen')).toBeTruthy());

    state.a = priced();
    await serverEmit('assignment:updated', { assignmentId: IDS.assignment, requestId: IDS.request, status: 'PRICE_PROPOSED' });
    await flush(50);
    expect(r.getPathname()).toBe(`${BASE}/chat`);

    await act(async () => router.back());
    await waitFor(() => expect(r.getPathname()).toBe(`${BASE}/pay`));
    await waitFor(() => expect(screen.getByTestId('pay-screen')).toBeTruthy());
  });
});

describe('settlement polling has a budget', () => {
  beforeEach(() => resetApp());

  it('helpers: poll only while waiting and within the budget', () => {
    expect(settlePollMs(undefined, false)).toBe(2000);
    expect(settlePollMs('PRICE_PROPOSED', false)).toBe(2000);
    expect(settlePollMs('PRICE_PROPOSED', true)).toBe(false);
    expect(settlePollMs('COMPLETED', false)).toBe(false);
    expect(settlePollMs('PRICE_DISPUTED', false)).toBe(false);
    expect(settlePollMs('CANCELLED_BY_CUSTOMER', false)).toBe(false);
    expect(paymentPollMs(undefined, false)).toBe(1500);
    expect(paymentPollMs('CREATED', false)).toBe(1500);
    expect(paymentPollMs('CREATED', true)).toBe(false);
    expect(paymentPollMs('SUCCEEDED', false)).toBe(false);
    expect(paymentPollMs('FAILED', false)).toBe(false);
  });

  it('tip page: stops asking after a minute while the payment never settles, then checks again on request', async () => {
    const { api } = jobSetup(priced({ payment: { intentId: M3.intent, status: 'CREATED' } }));
    await renderRouter(APP_DIR, { initialUrl: `${BASE}/tip` });
    await waitFor(() => expect(screen.getByTestId('tip-unavailable')).toBeTruthy());
    expect(screen.getByText('Ödəniş yoxlanılır...')).toBeTruthy();
    for (let elapsed = 0; elapsed <= SETTLE_MAX_MS; elapsed += 2000) await flush(2000);
    await waitFor(() => expect(screen.getByText('Ödəniş hələ təsdiqlənməyib. Bir az sonra yenidən yoxlayın')).toBeTruthy());
    const gets = () => api.find('GET', `/assignments/${IDS.assignment}`).length;
    const stopped = gets();
    expect(stopped).toBeGreaterThan(10);
    await flush(20_000);
    expect(gets()).toBe(stopped);

    await fireEvent.press(screen.getByTestId('tip-recheck'));
    await waitFor(() => expect(gets()).toBeGreaterThan(stopped));
    expect(screen.getByText('Ödəniş yoxlanılır...')).toBeTruthy();
  });

  it('tip page: a disputed job is not polled at all', async () => {
    const { api } = jobSetup(priced({ status: 'PRICE_DISPUTED', actions: { ...priced().actions, confirmPrice: false } }));
    await renderRouter(APP_DIR, { initialUrl: `${BASE}/tip` });
    await waitFor(() => expect(screen.getByTestId('tip-unavailable')).toBeTruthy());
    expect(screen.getByText('Bəxşiş yalnız kartla ödənilmiş işlər üçün mümkündür')).toBeTruthy();
    const first = api.find('GET', `/assignments/${IDS.assignment}`).length;
    await flush(10_000);
    expect(api.find('GET', `/assignments/${IDS.assignment}`).length).toBe(first);
  });

  it('payment landing: an abandoned checkout (CREATED) stops polling after a minute and offers to check again', async () => {
    const api = signedInCustomer({ extra: [on('GET', '/payments/:id', () => ok(intent({ status: 'CREATED', completedAt: null })))] });
    await renderRouter(APP_DIR, { initialUrl: `/payment?paymentIntentId=${M3.intent}` });
    await waitFor(() => expect(screen.getByTestId('payment-status')).toBeTruthy());
    expect(screen.getByText('Ödəniş yoxlanılır...')).toBeTruthy();
    expect(screen.queryByTestId('payment-recheck')).toBeNull();
    for (let elapsed = 0; elapsed <= SETTLE_MAX_MS; elapsed += 1500) await flush(1500);
    await waitFor(() => expect(screen.getByTestId('payment-recheck')).toBeTruthy());
    expect(screen.getByText('Ödəniş hələ təsdiqlənməyib. Bir az sonra yenidən yoxlayın')).toBeTruthy();
    const gets = () => api.find('GET', `/payments/${M3.intent}`).length;
    const stopped = gets();
    await flush(20_000);
    expect(gets()).toBe(stopped);
    await fireEvent.press(screen.getByTestId('payment-recheck'));
    await waitFor(() => expect(gets()).toBeGreaterThan(stopped));
  });
});

describe('card confirm without a checkout', () => {
  beforeEach(() => resetApp());

  it('a 0 ₼ card confirm (no payment returned) is not reported as a cash payment', async () => {
    const { api, state } = jobSetup(priced({ price: { labor: 0, materials: 0, total: 0 } }));
    api.use(
      on('POST', '/assignments/:id/confirm-price', () => {
        state.a = completed({ price: { labor: 0, materials: 0, total: 0 }, payment: null, actions: { ...completed().actions, tip: false } });
        return ok({ assignment: state.a, payment: null });
      }),
    );
    const r = await renderRouter(APP_DIR, { initialUrl: `${BASE}/pay` });
    await waitFor(() => expect(screen.getByTestId('pay-submit')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('pay-submit'));
    await waitFor(() => expect(r.getPathname()).toBe(`${BASE}/rate`));
    expect(api.find('POST', `/assignments/${IDS.assignment}/confirm-price`)[0].body).toEqual({ method: 'CARD', returnUrl: 'tezfiks://payment' });
    expect(screen.getByText('Ödəniş tələb olunmur — iş tamamlandı')).toBeTruthy();
    expect(screen.queryByText('Nağd ödəniş təsdiqləndi')).toBeNull();
  });
});

describe('company info', () => {
  beforeEach(() => resetApp());

  it('a failed account load shows the error with retry instead of an endless spinner', async () => {
    let failing = true;
    signedInCustomer({
      extra: [on('GET', '/customer/account', () => (failing ? fail(500, 'INTERNAL') : undefined))],
    });
    await renderRouter(APP_DIR, { initialUrl: '/profile/company' });
    await waitFor(() => expect(screen.getByTestId('company-error')).toBeTruthy(), { timeout: 10_000 });
    expect(screen.queryByTestId('company-loading')).toBeNull();
    failing = false;
    await fireEvent.press(screen.getByTestId('company-error-retry'));
    await waitFor(() => expect(screen.getByTestId('company-save')).toBeTruthy());
  });
});

describe('project guarantee uses the server clock', () => {
  afterEach(async () => {
    await act(async () => clockStore.getState().reset());
  });
  beforeEach(() => resetApp());

  it('helper', () => {
    const now = Date.parse('2026-10-25T10:00:00.000Z');
    const p = { guaranteeUntil: '2026-10-25T11:00:00.000Z' };
    expect(projectGuaranteeOpen(p, 0, now)).toBe(true);
    expect(projectGuaranteeOpen(p, 2 * 60 * 60_000, now)).toBe(false);
    expect(projectGuaranteeOpen({ guaranteeUntil: null }, 0, now)).toBe(false);
    expect(projectGuaranteeOpen({ guaranteeUntil: 'garbage' }, 0, now)).toBe(false);
  });

  function paidProject(guaranteeUntil: string) {
    return project({ status: 'PAID', canCancel: false, rated: true, awardedQuote: companyQuote({ status: 'ACCEPTED' }), guaranteeUntil });
  }

  it('the device clock says open, the server clock says expired: no claim button, and the claim screen refuses', async () => {
    const until = new Date(Date.now() + 60 * 60_000).toISOString();
    signedInCustomer({ extra: [on('GET', '/projects/:id', () => ok(paidProject(until)))] });
    await act(async () => clockStore.setState({ offsetMs: 2 * 60 * 60_000 }));
    await renderRouter(APP_DIR, { initialUrl: `/project/${M3.project}` });
    await waitFor(() => expect(screen.getByTestId('project-screen')).toBeTruthy());
    expect(screen.queryByTestId('project-guarantee')).toBeNull();
  });

  it('the claim screen shows the form only while the guarantee runs', async () => {
    const expired = new Date(Date.now() - 60_000).toISOString();
    signedInCustomer({ extra: [on('GET', '/projects/:id', () => ok(paidProject(expired)))] });
    await renderRouter(APP_DIR, { initialUrl: `/project/${M3.project}/guarantee` });
    await waitFor(() => expect(screen.getByTestId('project-guarantee-unavailable')).toBeTruthy());
    expect(screen.queryByTestId('project-guarantee-form')).toBeNull();
    expect(screen.getByText('Zəmanət yalnız kartla ödənilmiş işlərə və zəmanət müddəti ərzində şamil olunur')).toBeTruthy();
  });

  it('within the guarantee (server clock) the button and the form are there', async () => {
    const until = new Date(Date.now() + 3 * 60 * 60_000).toISOString();
    signedInCustomer({ extra: [on('GET', '/projects/:id', () => ok(paidProject(until)))] });
    await act(async () => clockStore.setState({ offsetMs: 60 * 60_000 }));
    const r = await renderRouter(APP_DIR, { initialUrl: `/project/${M3.project}` });
    await waitFor(() => expect(screen.getByTestId('project-guarantee')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('project-guarantee'));
    await waitFor(() => expect(r.getPathname()).toBe(`/project/${M3.project}/guarantee`));
    await waitFor(() => expect(screen.getByTestId('project-guarantee-form')).toBeTruthy());
  });
});

describe('chat read receipts', () => {
  beforeEach(() => resetApp());

  it('helpers: only the messages shown at send time are marked read', () => {
    const a = message({ id: 'm1' }) as ChatItem;
    const b = message({ id: 'm2' }) as ChatItem;
    const mine = message({ id: 'm3', senderUserId: 'u1', senderSide: 'CUSTOMER' }) as ChatItem;
    const pending: ChatItem = { ...message({ id: 'temp-1' }), tempId: 'temp-1', pending: true };
    expect(unreadIdsFromOthers([a, b, mine, pending], 'u1')).toEqual(['m1', 'm2']);
    const after = markReadLocally([a, b, mine], ['m1'], '2026-10-25T10:30:00.000Z');
    expect(after.map((m) => m.readAt)).toEqual(['2026-10-25T10:30:00.000Z', null, null]);
    expect(markReadLocally([a], [], 'x')).toEqual([a]);
  });

  it('a failed receipt is sent again a few seconds later', async () => {
    let attempts = 0;
    const { api } = jobSetup(enRouteUnlocked(), [
      on('POST', '/assignments/:id/messages/read', () => {
        attempts += 1;
        return attempts === 1 ? fail(500, 'INTERNAL') : ok({ ok: true });
      }),
    ]);
    await renderRouter(APP_DIR, { initialUrl: `${BASE}/chat` });
    await waitFor(() => expect(screen.getByText('Salam, 5 dəqiqəyə çatıram')).toBeTruthy());
    await waitFor(() => expect(api.find('POST', `/assignments/${IDS.assignment}/messages/read`)).toHaveLength(1));
    await flush(1000);
    expect(api.find('POST', `/assignments/${IDS.assignment}/messages/read`)).toHaveLength(1);
    await flush(5000);
    await waitFor(() => expect(api.find('POST', `/assignments/${IDS.assignment}/messages/read`)).toHaveLength(2));
    // Confirmed: no further receipts while nothing new arrives.
    await flush(10_000);
    expect(api.find('POST', `/assignments/${IDS.assignment}/messages/read`)).toHaveLength(2);
  });
});

describe('orders header', () => {
  beforeEach(() => resetApp());

  it('the business orders icon has an accessible name', async () => {
    signedInCustomer();
    await renderRouter(APP_DIR, { initialUrl: '/orders' });
    await waitFor(() => expect(screen.getByTestId('orders-business')).toBeTruthy());
    expect(screen.getByLabelText('Biznes sifarişləri')).toBeTruthy();
  });
});

function enRouteUnlocked(): CustomerAssignment {
  return priced({ status: 'EN_ROUTE', price: null, actions: { ...priced().actions, confirmPrice: false, disputePrice: false } });
}
