import React from 'react';
import { Platform, StyleSheet, Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { initI18n } from '../src/i18n';
import { createMobileRuntime, RuntimeProvider } from '../src/runtime';
import { createMemoryStorage } from '../src/storage';
import { otpFlowStore } from '../src/auth/flow';
import { Screen } from '../src/ui/Screen';
import { PhoneScreen } from '../src/screens/auth/PhoneScreen';

// The real KeyboardAvoidingView does not pass `behavior` to its host view; this stand-in exposes the props it was given.
jest.mock('react-native/Libraries/Components/Keyboard/KeyboardAvoidingView', () => {
  const React = require('react');
  const View = jest.requireActual('react-native/Libraries/Components/View/View').default;
  const Kav = (props: Record<string, unknown>) => React.createElement(View, { ...props, testID: 'keyboard-avoiding-view' });
  return { __esModule: true, default: Kav };
});

// A 360x640 dp phone (720x1280 at 320 dpi), where the keyboard covered the phone field and "Davam et".
const metrics = { frame: { x: 0, y: 0, width: 360, height: 640 }, insets: { top: 24, left: 0, right: 0, bottom: 0 } };

/**
 * Expo SDK 58 apps draw edge-to-edge on Android: the window no longer resizes for the keyboard, so screens have to
 * avoid it themselves (jest-expo/android runs these tests with Platform.OS === 'android').
 */
describe('keyboard avoidance on Android (edge-to-edge)', () => {
  beforeAll(async () => {
    await initI18n({ appNamespace: 'customer', storage: createMemoryStorage(), language: 'az' });
  });

  it('runs as Android', () => {
    expect(Platform.OS).toBe('android');
  });

  it.each([
    ['scrolling', true],
    ['static', false],
  ])('a %s Screen pads its content above the keyboard', async (_name, scroll) => {
    await render(
      <SafeAreaProvider initialMetrics={metrics}>
        <Screen scroll={scroll}>
          <Text>x</Text>
        </Screen>
      </SafeAreaProvider>,
    );
    expect(screen.getByTestId('keyboard-avoiding-view').props.behavior).toBe('padding');
  });

  it('the login hero can shrink so the title, the phone field and "Davam et" fit above the keyboard', async () => {
    otpFlowStore.getState().clear();
    const runtime = createMobileRuntime({ app: 'CUSTOMER', apiUrl: 'http://x/api', storage: createMemoryStorage(), fetch: jest.fn() as never, getLocale: () => 'az' });
    await render(
      <SafeAreaProvider initialMetrics={metrics}>
        <RuntimeProvider runtime={runtime}>
          <PhoneScreen onCodeSent={jest.fn()} />
        </RuntimeProvider>
      </SafeAreaProvider>,
    );
    expect(screen.getByTestId('keyboard-avoiding-view').props.behavior).toBe('padding');
    const hero = StyleSheet.flatten(screen.getByTestId('phone-hero').props.style);
    expect(hero.minHeight).toBeLessThanOrEqual(80);
    expect(screen.getByTestId('phone-input')).toBeTruthy();
    expect(screen.getByTestId('phone-continue')).toBeTruthy();
  });
});
