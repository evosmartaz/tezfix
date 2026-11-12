import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import path from 'node:path';
import type { ChatMessage } from '@tezfiks/shared';
import { emitServerEvent, resetApp, UUID } from './pro-helpers';
import { assignment } from './fixtures';
import { apiError, installPro, ok, on } from './m4-helpers';
import { mergeMessages } from '../src/lib/chat';
import { notificationHref } from '../src/lib/notifications';

const APP_DIR = path.join(__dirname, '..', 'src', 'app');
const JOB = UUID(530);

afterEach(() => resetApp());

function msg(n: number, over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: UUID(9100 + n),
    assignmentId: JOB,
    senderSide: 'CUSTOMER',
    senderUserId: UUID(77),
    senderName: 'Nizami T.',
    body: `Salam ${n}`,
    createdAt: new Date(Date.parse('2026-10-25T10:00:00.000Z') + n * 60_000).toISOString(),
    readAt: null,
    ...over,
  };
}

describe('chat helpers', () => {
  it('merges new messages newest first, once', () => {
    const list = [msg(2), msg(1)];
    expect(mergeMessages(list, msg(3)).map((m) => m.id)).toEqual([UUID(9103), UUID(9102), UUID(9101)]);
    expect(mergeMessages(list, msg(2)).map((m) => m.id)).toEqual([UUID(9102), UUID(9101)]);
  });

  it('notification targets use ids only', () => {
    expect(notificationHref({ data: { assignmentId: 'a1' } })).toBe('/job/a1');
    expect(notificationHref({ data: { assignmentId: 'a1', companyId: 'c1' } })).toBe('/company/c1/jobs/a1');
    expect(notificationHref({ data: { projectId: 'p1' } })).toBe('/projects/p1');
    expect(notificationHref({ data: {} })).toBeNull();
  });
});

describe('chat with the customer', () => {
  it('shows the conversation, sends a message, merges socket messages and marks as read', async () => {
    const world = installPro({
      assignments: [assignment({ id: JOB, status: 'EN_ROUTE', contactUnlocked: true, chatEnabled: true, customerPhone: '+994501234567' })],
      routes: [
        on('GET', `/assignments/${JOB}/messages`, () => ok({ items: [msg(1)], nextCursor: null })),
        on('POST', `/assignments/${JOB}/messages/read`, () => ok({ ok: true })),
        on('POST', `/assignments/${JOB}/messages`, (c) =>
          ok(msg(2, { senderSide: 'PROVIDER', senderUserId: UUID(2), senderName: 'Elvin M.', body: (c.body as { body: string }).body })),
        ),
      ],
    });
    const r = await renderRouter(APP_DIR, { initialUrl: `/job/${JOB}` });
    await waitFor(() => expect(screen.getByTestId('job-chat')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('job-chat'));
    await waitFor(() => expect(r.getPathname()).toBe(`/job/${JOB}/chat`));
    await waitFor(() => expect(screen.getByText('Salam 1')).toBeTruthy());
    await waitFor(() => expect(world.calls.some((c) => c.path === `/assignments/${JOB}/messages/read`)).toBe(true));

    await fireEvent.changeText(screen.getByTestId('chat-input'), '  5 dəqiqəyə çatıram  ');
    await fireEvent.press(screen.getByTestId('chat-send'));
    await waitFor(() => expect(screen.getByText('5 dəqiqəyə çatıram')).toBeTruthy());
    expect(world.calls.find((c) => c.method === 'POST' && c.path === `/assignments/${JOB}/messages`)!.body).toEqual({ body: '5 dəqiqəyə çatıram' });
    expect(screen.getByTestId('chat-input').props.value).toBe('');

    await act(async () => {
      emitServerEvent('chat:message', msg(3, { body: 'Gözləyirəm' }));
      emitServerEvent('chat:message', msg(4, { assignmentId: UUID(999), body: 'Başqa sifariş' }));
    });
    await waitFor(() => expect(screen.getByText('Gözləyirəm')).toBeTruthy());
    expect(screen.queryByText('Başqa sifariş')).toBeNull();
  });

  it('CHAT_LOCKED hides the composer and explains when the chat opens', async () => {
    installPro({
      assignments: [assignment({ id: JOB })],
      routes: [on('GET', `/assignments/${JOB}/messages`, () => apiError(403, 'CHAT_LOCKED'))],
    });
    await renderRouter(APP_DIR, { initialUrl: `/job/${JOB}/chat` });
    await waitFor(() => expect(screen.getByTestId('chat-locked')).toBeTruthy());
    expect(screen.getByText('Söhbət müştəriyə təxminən 5 dəqiqə qalmış açılacaq')).toBeTruthy();
    expect(screen.queryByTestId('chat-input')).toBeNull();
  });

  it('a proposed price paid by card shows the pending payment state', async () => {
    installPro({
      assignments: [
        assignment({ id: JOB, status: 'PRICE_PROPOSED', price: { labor: 3500, materials: 1000, total: 4500 }, paymentMethod: 'CARD', paymentStatus: 'CREATED' }),
      ],
    });
    await renderRouter(APP_DIR, { initialUrl: `/job/${JOB}` });
    await waitFor(() => expect(screen.getByTestId('job-state-awaiting-customer')).toBeTruthy());
    expect(screen.getByTestId('job-payment-status').props.children).toBe('Gözləyir');
    expect(screen.getByText('Ödəniş: Kartla ödəmə')).toBeTruthy();
  });
});
