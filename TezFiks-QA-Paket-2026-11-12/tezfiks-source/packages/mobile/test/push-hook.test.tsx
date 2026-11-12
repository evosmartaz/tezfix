import React from 'react';
import { Text } from 'react-native';
import { act, render } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import { createMobileRuntime, RuntimeProvider, type MobileRuntime } from '../src/runtime';
import { createMemoryStorage } from '../src/storage';
import { usePushRegistration } from '../src/providers';
import { NOTIFICATION_CHANNELS } from '../src/push';
import { makeMe } from './fixtures';

const BASE = 'http://10.0.2.2:3000/tezfix/api';
const TOKENS = { accessToken: 'a', refreshToken: 'r', accessExpiresAt: 'x', refreshExpiresAt: 'y' };

function setup() {
  const deviceCalls: unknown[] = [];
  const fetchFn = jest.fn(async (url: string, init: RequestInit) => {
    if (String(url).endsWith('/me/devices')) deviceCalls.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
  const rt = createMobileRuntime({ app: 'CUSTOMER', apiUrl: BASE, storage: createMemoryStorage(), fetch: fetchFn, getLocale: () => 'az' });
  return { rt, deviceCalls };
}

function Harness({ names }: { names: { offers: string; default: string } }) {
  const res = usePushRegistration(names);
  return <Text testID="registered">{res?.registered ? 'yes' : 'no'}</Text>;
}

async function mount(rt: MobileRuntime, names: { offers: string; default: string }) {
  const view = await render(
    <RuntimeProvider runtime={rt}>
      <Harness names={names} />
    </RuntimeProvider>,
  );
  const rerender = (n: { offers: string; default: string }) =>
    view.rerender(
      <RuntimeProvider runtime={rt}>
        <Harness names={n} />
      </RuntimeProvider>,
    );
  return { view, rerender };
}

const flush = () => act(async () => new Promise((r) => setTimeout(r, 0)));
const setChannel = Notifications.setNotificationChannelAsync as jest.Mock;

beforeEach(() => setChannel.mockClear());

describe('usePushRegistration', () => {
  it('waits for translated channel names before creating channels and registering', async () => {
    const { rt, deviceCalls } = setup();
    await act(async () => {
      await rt.auth.getState().signIn(TOKENS, makeMe());
    });
    // Before i18n init useT() returns '' for every key.
    const { rerender } = await mount(rt, { offers: '', default: '' });
    await flush();
    expect(deviceCalls).toHaveLength(0);
    expect(setChannel).not.toHaveBeenCalled();

    await act(async () => {
      await rerender({ offers: 'Yeni sifarişlər', default: 'Bildirişlər' });
    });
    await flush();
    expect(deviceCalls).toHaveLength(1);
    expect(setChannel).toHaveBeenCalledWith(NOTIFICATION_CHANNELS.offers, expect.objectContaining({ name: 'Yeni sifarişlər' }));
    for (const call of setChannel.mock.calls) expect((call[1] as { name: string }).name).not.toBe('');
  });

  it('renames the channels after a language switch without registering again', async () => {
    const { rt, deviceCalls } = setup();
    await act(async () => {
      await rt.auth.getState().signIn(TOKENS, makeMe());
    });
    const { rerender } = await mount(rt, { offers: 'Yeni sifarişlər', default: 'Bildirişlər' });
    await flush();
    expect(deviceCalls).toHaveLength(1);
    setChannel.mockClear();

    await act(async () => {
      await rerender({ offers: 'Новые заказы', default: 'Уведомления' });
    });
    await flush();
    expect(setChannel).toHaveBeenCalledWith(NOTIFICATION_CHANNELS.offers, expect.objectContaining({ name: 'Новые заказы' }));
    expect(setChannel).toHaveBeenCalledWith(NOTIFICATION_CHANNELS.default, expect.objectContaining({ name: 'Уведомления' }));
    expect(deviceCalls).toHaveLength(1);
  });

  it('registers again when the same user signs out and back in during one process', async () => {
    const { rt, deviceCalls } = setup();
    await act(async () => {
      await rt.auth.getState().signIn(TOKENS, makeMe());
    });
    await mount(rt, { offers: 'a', default: 'b' });
    await flush();
    expect(deviceCalls).toHaveLength(1);

    await act(async () => {
      await rt.auth.getState().logout({ remote: false });
    });
    await flush();
    await act(async () => {
      await rt.auth.getState().signIn(TOKENS, makeMe());
    });
    await flush();
    expect(deviceCalls).toHaveLength(2);
  });
});
