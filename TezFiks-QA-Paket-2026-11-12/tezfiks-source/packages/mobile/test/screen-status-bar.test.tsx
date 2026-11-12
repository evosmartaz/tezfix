import React from 'react';
import { StatusBar } from 'react-native';
import { render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Screen } from '../src/ui/Screen';

const metrics = { frame: { x: 0, y: 0, width: 360, height: 640 }, insets: { top: 24, left: 0, right: 0, bottom: 0 } };

/** The bar style of the top-most mounted <StatusBar> (React Native keeps a stack; the last mounted one wins). */
function topBarStyle(): string | undefined {
  const stack = (StatusBar as unknown as { _propsStack: Array<{ barStyle?: { value: string } }> })._propsStack;
  return stack.at(-1)?.barStyle?.value;
}

/**
 * The root layouts set dark status-bar icons for the whole app, so on the dark login screen the clock and icons were
 * invisible (seen on the emulator). Every Screen now sets icons that contrast with its own background.
 */
describe('Screen status bar', () => {
  it('dark screens get light status-bar icons, light screens dark ones', async () => {
    const dark = await render(
      <SafeAreaProvider initialMetrics={metrics}>
        <Screen dark testID="dark-screen">{null}</Screen>
      </SafeAreaProvider>,
    );
    expect(topBarStyle()).toBe('light-content');
    await dark.unmount();

    await render(
      <SafeAreaProvider initialMetrics={metrics}>
        <Screen testID="light-screen">{null}</Screen>
      </SafeAreaProvider>,
    );
    expect(topBarStyle()).toBe('dark-content');
  });
});
