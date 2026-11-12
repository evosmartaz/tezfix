import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import path from 'node:path';
import type { ChatMessage } from '@tezfiks/shared';
import { IDS } from './fixtures';
import { M3, enRoute, message } from './fixtures-m3';
import { fail, flush, ok, on, resetApp, serverEmit, signedInCustomer } from './screen-helpers';

const APP_DIR = path.join(__dirname, '..', 'src', 'app');
const URL = `/assignment/${IDS.assignment}/chat`;
const unlocked = () => enRoute({ etaSec: 200, contactUnlocked: true, providerPhone: '+994501112233', chatEnabled: true });

function setup(a = unlocked(), history: ChatMessage[] = [message()]) {
  const sent: ChatMessage[] = [];
  const api = signedInCustomer({
    extra: [
      on('GET', '/assignments/:id', () => ok(a)),
      on('GET', '/assignments/:id/messages', () => ok({ items: history, nextCursor: null })),
      on('POST', '/assignments/:id/messages/read', () => ok({ ok: true })),
      on('POST', '/assignments/:id/messages', (c) => {
        const m = message({ id: `s${sent.length + 1}`, senderSide: 'CUSTOMER', senderUserId: 'u1', senderName: 'Nizami Tağızadə', body: (c.body as { body: string }).body, createdAt: '2026-10-25T10:25:00.000Z', readAt: null });
        sent.push(m);
        return ok(m);
      }),
    ],
  });
  return { api, sent };
}

describe('chat with the handyman', () => {
  beforeEach(() => resetApp());

  it('loads the history, marks the handyman messages read and sends with an optimistic bubble', async () => {
    const { api } = setup();
    await renderRouter(APP_DIR, { initialUrl: URL });
    await waitFor(() => expect(screen.getByText('Salam, 5 dəqiqəyə çatıram')).toBeTruthy());
    await waitFor(() => expect(api.find('POST', `/assignments/${IDS.assignment}/messages/read`)).toHaveLength(1));
    await fireEvent.changeText(screen.getByTestId('chat-input'), '  Gözləyirəm, giriş 2  ');
    await fireEvent.press(screen.getByTestId('chat-send'));
    await waitFor(() => expect(api.find('POST', `/assignments/${IDS.assignment}/messages`)).toHaveLength(1));
    expect(api.find('POST', `/assignments/${IDS.assignment}/messages`)[0].body).toEqual({ body: 'Gözləyirəm, giriş 2' });
    await waitFor(() => expect(screen.getByTestId('chat-msg-s1')).toBeTruthy());
    expect(screen.getAllByText('Gözləyirəm, giriş 2')).toHaveLength(1);
    expect(screen.getByTestId('chat-input').props.value).toBe('');
  });

  it('a chat:message from the socket appears once, even if it is the copy of my own message', async () => {
    const { sent } = setup();
    await renderRouter(APP_DIR, { initialUrl: URL });
    await waitFor(() => expect(screen.getByText('Salam, 5 dəqiqəyə çatıram')).toBeTruthy());
    await serverEmit('chat:message', message({ id: M3.message2, body: 'Qapının kodu nədir?', createdAt: '2026-10-25T10:22:00.000Z' }));
    await waitFor(() => expect(screen.getByText('Qapının kodu nədir?')).toBeTruthy());
    // Messages of another assignment are not shown here.
    await serverEmit('chat:message', message({ id: 'other', assignmentId: M3.assignment2, body: 'Başqa sifariş' }));
    await flush(10);
    expect(screen.queryByText('Başqa sifariş')).toBeNull();

    await fireEvent.changeText(screen.getByTestId('chat-input'), '1234');
    await fireEvent.press(screen.getByTestId('chat-send'));
    await waitFor(() => expect(sent).toHaveLength(1));
    await serverEmit('chat:message', sent[0]);
    await flush(10);
    expect(screen.getAllByText('1234')).toHaveLength(1);
  });

  it('CHAT_LOCKED marks the message failed; a tap retries it', async () => {
    let locked = true;
    const { api } = setup();
    api.use(
      on('POST', '/assignments/:id/messages', (c) =>
        locked ? fail(409, 'CHAT_LOCKED') : ok(message({ id: 'ok1', senderUserId: 'u1', senderSide: 'CUSTOMER', body: (c.body as { body: string }).body })),
      ),
    );
    await renderRouter(APP_DIR, { initialUrl: URL });
    await waitFor(() => expect(screen.getByTestId('chat-input')).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('chat-input'), 'Salam');
    await fireEvent.press(screen.getByTestId('chat-send'));
    await waitFor(() => expect(screen.getByText('Göndərilmədi — yenidən cəhd üçün toxunun')).toBeTruthy());
    locked = false;
    const failed = screen.getAllByTestId(/^chat-msg-temp-/)[0];
    await fireEvent.press(failed);
    await waitFor(() => expect(screen.getByTestId('chat-msg-ok1')).toBeTruthy());
    expect(screen.queryByText('Göndərilmədi — yenidən cəhd üçün toxunun')).toBeNull();
  });

  it('before the contact unlock the composer is disabled with the explanation', async () => {
    const { api } = setup(enRoute(), []);
    await renderRouter(APP_DIR, { initialUrl: URL });
    await waitFor(() => expect(screen.getByTestId('chat-locked')).toBeTruthy());
    expect(within(screen.getByTestId('chat-locked')).getByText('Mesajlaşma usta çatmağına təxminən 5 dəqiqə qalanda açılır')).toBeTruthy();
    expect(screen.getByTestId('chat-input').props.editable).toBe(false);
    await fireEvent.press(screen.getByTestId('chat-send'));
    expect(api.find('POST', `/assignments/${IDS.assignment}/messages`)).toHaveLength(0);
    expect(screen.queryByTestId('chat-call')).toBeNull();
  });

  it('after the chat window closed the history stays readable', async () => {
    setup({ ...unlocked(), status: 'COMPLETED', chatEnabled: false });
    await renderRouter(APP_DIR, { initialUrl: URL });
    await waitFor(() => expect(screen.getByText('Söhbət bağlanıb')).toBeTruthy());
    expect(screen.getByText('Salam, 5 dəqiqəyə çatıram')).toBeTruthy();
  });
});
