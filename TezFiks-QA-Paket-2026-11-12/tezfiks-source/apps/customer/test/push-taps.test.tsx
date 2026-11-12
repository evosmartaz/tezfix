import { act, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import path from 'node:path';
import * as Notifications from 'expo-notifications';
import { IDS } from './fixtures';
import { M3, message, priced, project } from './fixtures-m3';
import { installFakeApi } from './helpers';
import { flush, ok, on, resetApp, signedInCustomer } from './screen-helpers';
import { pushPayload, pushTapHref, type PushTap } from '../src/lib/notifications';

const APP_DIR = path.join(__dirname, '..', 'src', 'app');

const listenerMock = Notifications.addNotificationResponseReceivedListener as unknown as jest.Mock;
const lastMock = Notifications.getLastNotificationResponseAsync as unknown as jest.Mock;
const clearMock = Notifications.clearLastNotificationResponseAsync as unknown as jest.Mock;

/** A tap as expo-notifications reports it. */
function tap(data: Record<string, unknown>, identifier = 'push-1'): PushTap {
  return { actionIdentifier: 'expo.modules.notifications.actions.DEFAULT', notification: { request: { identifier, content: { data } } } };
}

/** The same push as an FCM data message from the API (`toFcmData`): ids only inside the JSON `body`. */
function fcmTap(type: string, data: Record<string, unknown>, identifier = 'push-fcm'): PushTap {
  return tap({ type, title: 'TezFiks', message: 'Yenilik', body: JSON.stringify({ type, ...data }), channelId: 'default_v1', priority: 'default' }, identifier);
}

/** Calls the response listener the app registered last (as the OS does when the user taps a push). */
async function userTaps(t: PushTap): Promise<void> {
  const calls = listenerMock.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  const listener = calls[calls.length - 1][0] as (r: PushTap) => void;
  await act(async () => {
    listener(t);
  });
  await flush(10);
}

const jobHandlers = [
  on('GET', '/assignments/:id', () => ok(priced())),
  on('GET', '/assignments/:id/messages', () => ok({ items: [message()], nextCursor: null })),
  on('POST', '/assignments/:id/messages/read', () => ok({ ok: true })),
  on('GET', '/projects/:id', () => ok(project())),
];

describe('push payloads', () => {
  it('reads Expo pushes (data = { type, ...ids })', () => {
    expect(pushPayload({ data: { type: 'PRICE_PROPOSED', assignmentId: IDS.assignment, amount: 4500 } })).toEqual({
      type: 'PRICE_PROPOSED',
      data: { assignmentId: IDS.assignment, amount: 4500 },
    });
  });

  it('reads FCM data messages (ids inside the JSON body) and drops the transport fields', () => {
    const t = fcmTap('CHAT_MESSAGE', { assignmentId: IDS.assignment, requestId: IDS.request });
    expect(pushPayload(t.notification?.request?.content)).toEqual({ type: 'CHAT_MESSAGE', data: { assignmentId: IDS.assignment, requestId: IDS.request } });
    expect(pushTapHref(t)).toBe(`/assignment/${IDS.assignment}/chat`);
  });

  it('opens the same screen as the in-app list', () => {
    expect(pushTapHref(tap({ type: 'PRICE_PROPOSED', assignmentId: IDS.assignment }))).toBe(`/assignment/${IDS.assignment}/pay`);
    expect(pushTapHref(tap({ type: 'ASSIGNMENT_NEAR', assignmentId: IDS.assignment }))).toBe(`/assignment/${IDS.assignment}`);
    expect(pushTapHref(fcmTap('QUOTE_RECEIVED', { projectId: M3.project }))).toBe(`/project/${M3.project}`);
    expect(pushTapHref(tap({ type: 'WALLET_TOPUP' }))).toBe('/wallet');
  });

  it('ignores pushes that are not TezFiks notifications or carry broken data', () => {
    expect(pushTapHref(null)).toBeNull();
    expect(pushTapHref({})).toBeNull();
    expect(pushTapHref(tap({ assignmentId: IDS.assignment }))).toBeNull();
    expect(pushPayload({ data: 'x' })).toBeNull();
    expect(pushPayload({ data: { body: '{broken' } })).toBeNull();
    // A broken JSON body still leaves the flat fields usable.
    expect(pushTapHref(tap({ type: 'CHAT_MESSAGE', assignmentId: IDS.assignment, body: '{broken' }))).toBe(`/assignment/${IDS.assignment}/chat`);
  });
});

describe('push taps open the referenced screen', () => {
  beforeEach(() => {
    resetApp();
    listenerMock.mockClear();
    lastMock.mockReset().mockResolvedValue(null);
    clearMock.mockClear();
  });

  it('a tap on "price proposed" while the app runs opens the payment screen', async () => {
    signedInCustomer({ extra: jobHandlers });
    const r = await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(r.getPathname()).toBe('/'));
    await waitFor(() => expect(screen.getByTestId('category-tile-plumbing')).toBeTruthy());
    await userTaps(tap({ type: 'PRICE_PROPOSED', assignmentId: IDS.assignment }));
    await waitFor(() => expect(r.getPathname()).toBe(`/assignment/${IDS.assignment}/pay`));
    await waitFor(() => expect(screen.getByTestId('pay-screen')).toBeTruthy());
  });

  it('a project push opens the project; the same push delivered twice opens it once', async () => {
    signedInCustomer({ extra: jobHandlers });
    const r = await renderRouter(APP_DIR, { initialUrl: '/orders' });
    await waitFor(() => expect(screen.getByTestId('orders-screen')).toBeTruthy());
    const t = fcmTap('QUOTE_RECEIVED', { projectId: M3.project }, 'push-quote');
    await userTaps(t);
    await waitFor(() => expect(r.getPathname()).toBe(`/project/${M3.project}`));
    await waitFor(() => expect(screen.getByTestId('project-screen')).toBeTruthy());
    const before = JSON.stringify(r.getRouterState());
    await userTaps(t);
    expect(r.getPathname()).toBe(`/project/${M3.project}`);
    expect(JSON.stringify(r.getRouterState())).toBe(before);
  });

  it('cold start from a chat push (FCM): after the session is restored the chat opens and the response is cleared', async () => {
    lastMock.mockResolvedValue(fcmTap('CHAT_MESSAGE', { assignmentId: IDS.assignment }, 'push-cold'));
    signedInCustomer({ extra: jobHandlers });
    const r = await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(r.getPathname()).toBe(`/assignment/${IDS.assignment}/chat`));
    await waitFor(() => expect(screen.getByTestId('chat-screen')).toBeTruthy());
    expect(clearMock).toHaveBeenCalled();
  });

  it('a push without a target keeps the current screen', async () => {
    signedInCustomer({ extra: jobHandlers });
    const r = await renderRouter(APP_DIR, { initialUrl: '/orders' });
    await waitFor(() => expect(screen.getByTestId('orders-screen')).toBeTruthy());
    await userTaps(tap({ type: 'GENERIC' }));
    expect(r.getPathname()).toBe('/orders');
  });

  it('signed out: a tap does not open the job, the login stays', async () => {
    installFakeApi([]);
    const r = await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(screen.getByTestId('phone-screen')).toBeTruthy());
    await userTaps(tap({ type: 'PRICE_PROPOSED', assignmentId: IDS.assignment }, 'push-signed-out'));
    await flush(50);
    expect(r.getPathname()).toBe('/phone');
    expect(screen.queryByTestId('pay-screen')).toBeNull();
  });
});
