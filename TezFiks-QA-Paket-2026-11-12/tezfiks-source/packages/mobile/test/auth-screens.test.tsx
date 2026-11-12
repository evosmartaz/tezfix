import React, { type ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { i18n, initI18n } from '../src/i18n';
import { createMobileRuntime, RuntimeProvider, type MobileRuntime } from '../src/runtime';
import { createMemoryStorage, STORAGE_KEYS } from '../src/storage';
import { otpFlowStore } from '../src/auth/flow';
import { ToastProvider } from '../src/ui/Toast';
import { PhoneScreen } from '../src/screens/auth/PhoneScreen';
import { OtpScreen } from '../src/screens/auth/OtpScreen';
import { ProfileScreen } from '../src/screens/auth/ProfileScreen';
import { makeMe } from './fixtures';

const BASE = 'http://10.0.2.2:3000/tezfix/api';
const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

type Reply = { status: number; body?: unknown };
interface Call {
  path: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function setup(handler: (path: string, body: unknown) => Reply, app: 'CUSTOMER' | 'PRO' = 'CUSTOMER') {
  const calls: Call[] = [];
  const fetchFn = jest.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const path = String(input).replace(BASE, '');
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    calls.push({ path, method: String(init.method), headers: (init.headers ?? {}) as Record<string, string>, body });
    const r = handler(path, body);
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
  const storage = createMemoryStorage();
  const runtime = createMobileRuntime({ app, apiUrl: BASE, storage, fetch: fetchFn, getLocale: () => 'az' });
  const wrap = (node: ReactNode) => (
    <SafeAreaProvider initialMetrics={metrics}>
      <RuntimeProvider runtime={runtime}>
        <ToastProvider>{node}</ToastProvider>
      </RuntimeProvider>
    </SafeAreaProvider>
  );
  return { runtime, storage, calls, wrap };
}

const challenge = (over: Record<string, unknown> = {}) => ({
  challengeId: 'ch_1',
  phone: '+994501234567',
  expiresAt: '2026-10-25T10:05:00.000Z',
  resendAfterSec: 60,
  channel: 'console',
  devCode: '482913',
  ...over,
});

const tokens = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  accessExpiresAt: '2026-10-25T10:15:00.000Z',
  refreshExpiresAt: '2026-11-24T10:00:00.000Z',
};

beforeAll(async () => {
  await initI18n({ appNamespace: 'customer', storage: createMemoryStorage(), language: 'az' });
});

beforeEach(() => {
  otpFlowStore.getState().clear();
});

describe('PhoneScreen', () => {
  it('requests a code for the normalized number and continues to the OTP screen', async () => {
    const { calls, wrap } = setup(() => ({ status: 200, body: challenge() }));
    const onCodeSent = jest.fn();
    await render(wrap(<PhoneScreen onCodeSent={onCodeSent} />));
    expect(screen.getByText('Telefon nömrəsi ilə daxil olun')).toBeTruthy();
    const button = screen.getByTestId('phone-continue');
    expect(button.props.accessibilityState.disabled).toBe(true);

    await fireEvent.changeText(screen.getByTestId('phone-input'), '050 123 45 67');
    expect(screen.getByTestId('phone-continue').props.accessibilityState.disabled).toBe(false);
    await fireEvent.press(screen.getByTestId('phone-continue'));

    await waitFor(() => expect(onCodeSent).toHaveBeenCalledTimes(1));
    expect(calls[0]).toMatchObject({ path: '/auth/otp/request', method: 'POST', body: { phone: '+994501234567', app: 'CUSTOMER', locale: 'az' } });
    expect(otpFlowStore.getState().challenge?.challengeId).toBe('ch_1');
  });

  it('shows the localized server error', async () => {
    const { wrap } = setup(() => ({ status: 429, body: { error: { code: 'OTP_COOLDOWN', message: 'x' } } }));
    const onCodeSent = jest.fn();
    await render(wrap(<PhoneScreen onCodeSent={onCodeSent} />));
    await fireEvent.changeText(screen.getByTestId('phone-input'), '0501234567');
    await fireEvent.press(screen.getByTestId('phone-continue'));
    await waitFor(() => expect(screen.getByText('Yeni kod üçün bir az gözləyin')).toBeTruthy());
    expect(onCodeSent).not.toHaveBeenCalled();
  });

  it('tells the user up front that the code comes over WhatsApp (there is no SMS)', async () => {
    const { wrap } = setup(() => ({ status: 200, body: challenge() }));
    await render(wrap(<PhoneScreen onCodeSent={jest.fn()} />));
    expect(screen.getByTestId('phone-whatsapp-hint').props.children).toBe('Təsdiq kodunu WhatsApp-a göndərəcəyik');
  });

  it('does not submit a landline number', async () => {
    const { calls, wrap } = setup(() => ({ status: 200, body: challenge() }));
    await render(wrap(<PhoneScreen onCodeSent={jest.fn()} />));
    await fireEvent.changeText(screen.getByTestId('phone-input'), '012 123 45 67');
    await fireEvent.press(screen.getByTestId('phone-continue'));
    expect(calls).toHaveLength(0);
  });
});

describe('OtpScreen', () => {
  it('shows the dev code hint, auto-submits 6 digits and signs in', async () => {
    const me = makeMe({ profileComplete: false, firstName: null, lastName: null });
    const { calls, wrap, runtime, storage } = setup((path) =>
      path === '/auth/otp/verify' ? { status: 200, body: { tokens, me, isNewUser: true } } : { status: 404 },
    );
    otpFlowStore.getState().setChallenge(challenge());
    const onSignedIn = jest.fn();
    const onBack = jest.fn();
    await render(wrap(<OtpScreen onBack={onBack} onSignedIn={onSignedIn} />));

    expect(screen.getByText('Təsdiq kodu')).toBeTruthy();
    expect(screen.getByText('Test rejimi: kodunuz 482913')).toBeTruthy();
    expect(screen.getByText(/^Kodu yenidən göndər \(0[01]:\d\d\)$/)).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId('otp-input'), '482913');
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(me, true));
    const verify = calls.find((c) => c.path === '/auth/otp/verify')!;
    expect(verify.body).toMatchObject({ challengeId: 'ch_1', code: '482913', app: 'CUSTOMER' });
    expect((verify.body as { deviceId: string }).deviceId.length).toBeGreaterThanOrEqual(8);
    expect(runtime.auth.getState()).toMatchObject({ status: 'signedIn', accessToken: 'access-1' });
    expect(storage.data.get(STORAGE_KEYS.refreshToken)).toBe('refresh-1');
    expect(otpFlowStore.getState().challenge).toBeNull();
    // Clearing the challenge after sign-in must not navigate back to the phone screen.
    expect(onBack).not.toHaveBeenCalled();
  });

  it.each([
    ['az', '+994 50 123 45 67 nömrəsinə WhatsApp ilə göndərilən 6 rəqəmli kodu daxil edin'],
    ['ru', 'Введите 6-значный код, отправленный в WhatsApp на номер +994 50 123 45 67'],
    ['en', 'Enter the 6-digit code sent via WhatsApp to +994 50 123 45 67'],
  ] as const)('the subtitle says where the code went: WhatsApp and the number (%s)', async (lng, text) => {
    const { wrap } = setup(() => ({ status: 200 }));
    otpFlowStore.getState().setChallenge(challenge({ channel: 'whatsapp', devCode: null }));
    await i18n.changeLanguage(lng);
    try {
      await render(wrap(<OtpScreen onBack={jest.fn()} onSignedIn={jest.fn()} />));
      expect(screen.getByText(text)).toBeTruthy();
    } finally {
      await i18n.changeLanguage('az');
    }
  });

  it('a wrong code shows the error and clears the boxes', async () => {
    const { wrap, runtime } = setup(() => ({ status: 400, body: { error: { code: 'OTP_INVALID', message: 'x' } } }));
    otpFlowStore.getState().setChallenge(challenge());
    const onSignedIn = jest.fn();
    await render(wrap(<OtpScreen onBack={jest.fn()} onSignedIn={onSignedIn} />));
    await fireEvent.changeText(screen.getByTestId('otp-input'), '000000');
    await waitFor(() => expect(screen.getByTestId('otp-error')).toBeTruthy());
    expect(screen.getByText('Kod yanlışdır')).toBeTruthy();
    expect(screen.getByTestId('otp-input').props.value).toBe('');
    expect(onSignedIn).not.toHaveBeenCalled();
    expect(runtime.auth.getState().status).not.toBe('signedIn');
  });

  it('resends the code when the timer allows it', async () => {
    const { calls, wrap } = setup(() => ({ status: 200, body: challenge({ challengeId: 'ch_2', devCode: '111222' }) }));
    otpFlowStore.getState().setChallenge(challenge({ resendAfterSec: 0 }));
    await render(wrap(<OtpScreen onBack={jest.fn()} onSignedIn={jest.fn()} />));
    expect(screen.getByText('Kodu yenidən göndər')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('otp-resend'));
    await waitFor(() => expect(screen.getByText('Yeni kod göndərildi')).toBeTruthy());
    expect(calls[0]).toMatchObject({ path: '/auth/otp/request', body: { phone: '+994501234567', app: 'CUSTOMER' } });
    expect(otpFlowStore.getState().challenge?.challengeId).toBe('ch_2');
    expect(screen.getByText('Test rejimi: kodunuz 111222')).toBeTruthy();
  });

  it('resend is disabled while the cooldown runs', async () => {
    const { calls, wrap } = setup(() => ({ status: 200, body: challenge() }));
    otpFlowStore.getState().setChallenge(challenge({ resendAfterSec: 60 }));
    await render(wrap(<OtpScreen onBack={jest.fn()} onSignedIn={jest.fn()} />));
    await fireEvent.press(screen.getByTestId('otp-resend'));
    expect(calls).toHaveLength(0);
  });

  it('without a pending challenge it returns to the phone screen', async () => {
    const { wrap } = setup(() => ({ status: 200 }));
    const onBack = jest.fn();
    await render(wrap(<OtpScreen onBack={onBack} onSignedIn={jest.fn()} />));
    expect(onBack).toHaveBeenCalled();
  });
});

describe('ProfileScreen', () => {
  async function signedIn(runtime: MobileRuntime) {
    await runtime.auth.getState().signIn(tokens, makeMe({ profileComplete: false, firstName: null, lastName: null }));
  }

  it('requires first and last name', async () => {
    const { calls, wrap, runtime } = setup(() => ({ status: 200 }));
    await signedIn(runtime);
    await render(wrap(<ProfileScreen onDone={jest.fn()} />));
    await fireEvent.press(screen.getByTestId('profile-save'));
    expect(screen.getByText('Adınızı daxil edin')).toBeTruthy();
    expect(screen.getByText('Soyadınızı daxil edin')).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it('saves Azerbaijani names intact and updates the session profile', async () => {
    const updated = makeMe({ firstName: 'İlqar', lastName: 'Şükürov', profileComplete: true });
    const { calls, wrap, runtime } = setup((path) => (path === '/me' ? { status: 200, body: updated } : { status: 404 }));
    await signedIn(runtime);
    const onDone = jest.fn();
    await render(wrap(<ProfileScreen onDone={onDone} />));
    await fireEvent.changeText(screen.getByTestId('profile-first-name'), '  İlqar ');
    await fireEvent.changeText(screen.getByTestId('profile-last-name'), 'Şükürov');
    await fireEvent.press(screen.getByTestId('profile-save'));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(updated));
    expect(calls[0]).toMatchObject({ path: '/me', method: 'PATCH', body: { firstName: 'İlqar', lastName: 'Şükürov' } });
    expect(calls[0].headers.Authorization).toBe('Bearer access-1');
    expect(runtime.auth.getState().me?.profileComplete).toBe(true);
  });

  it('resizes the picked photo before uploading it and links it to the profile', async () => {
    const ImagePicker = require('expo-image-picker') as { launchImageLibraryAsync: jest.Mock };
    const manip = require('expo-image-manipulator') as { ImageManipulator: { manipulate: jest.Mock } };
    manip.ImageManipulator.manipulate.mockClear();
    ImagePicker.launchImageLibraryAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///picked/photo.jpg', mimeType: 'image/jpeg', fileName: 'photo.jpg', width: 3024, height: 3024 }],
    });
    const updated = makeMe({ firstName: 'Aysel', lastName: 'Quliyeva', profileComplete: true });
    const { calls, wrap, runtime } = setup((path) => {
      if (path === '/files') return { status: 201, body: { id: '11111111-1111-4111-8111-111111111111', kind: 'PROFILE_PHOTO', url: 'http://x/f.jpg', contentType: 'image/jpeg', width: 1600, height: 1600 } };
      if (path === '/me') return { status: 200, body: updated };
      return { status: 404 };
    });
    await signedIn(runtime);
    const onDone = jest.fn();
    await render(wrap(<ProfileScreen onDone={onDone} />));
    await fireEvent.press(screen.getByTestId('profile-photo'));
    await waitFor(() => expect(screen.getByText('Şəkli dəyiş')).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('profile-first-name'), 'Aysel');
    await fireEvent.changeText(screen.getByTestId('profile-last-name'), 'Quliyeva');
    await fireEvent.press(screen.getByTestId('profile-save'));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(updated));

    expect(manip.ImageManipulator.manipulate).toHaveBeenCalledWith('file:///picked/photo.jpg');
    const ctx = manip.ImageManipulator.manipulate.mock.results[0].value as { resize: jest.Mock };
    expect(ctx.resize).toHaveBeenCalledWith({ width: 1600 });
    const upload = calls.find((c) => c.path === '/files');
    const fd = upload?.body as { getParts?: () => Array<{ fieldName: string; uri?: string }>; _parts?: Array<[string, { uri?: string }]> };
    const fileUri = fd.getParts ? fd.getParts().find((p) => p.fieldName === 'file')?.uri : fd._parts?.find(([k]) => k === 'file')?.[1].uri;
    expect(fileUri).toMatch(/manipulated-\d+\.jpg$/);
    expect(fileUri).not.toBe('file:///picked/photo.jpg');
    expect(calls.find((c) => c.path === '/me')?.body).toEqual({ firstName: 'Aysel', lastName: 'Quliyeva', photoFileId: '11111111-1111-4111-8111-111111111111' });
  });
});
