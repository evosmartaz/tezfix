/* App-level Jest setup: reuse the shared native mocks and replace the realtime socket with an inert fake. */
import '../../../packages/mobile/test/setup';

jest.mock('socket.io-client', () => {
  interface MockSocket {
    connected: boolean;
    on: jest.Mock;
    off: jest.Mock;
    emit: jest.Mock;
    connect: jest.Mock;
    disconnect: jest.Mock;
  }
  const make = (): MockSocket => {
    const socket: MockSocket = {
      connected: false,
      on: jest.fn(),
      off: jest.fn(),
      emit: jest.fn(),
      connect: jest.fn((): MockSocket => {
        socket.connected = true;
        return socket;
      }),
      disconnect: jest.fn((): MockSocket => {
        socket.connected = false;
        return socket;
      }),
    };
    return socket;
  };
  return { io: jest.fn(make) };
});

// Device position for screens that pin the current location (Baku, Nərimanov). Tests may override per case.
{
  const Location = require('expo-location') as Record<string, unknown>;
  Location.Accuracy = { Balanced: 3, High: 4 };
  Location.getLastKnownPositionAsync = jest.fn(async () => ({ coords: { latitude: 40.4093, longitude: 49.8671 } }));
  Location.getCurrentPositionAsync = jest.fn(async () => ({ coords: { latitude: 40.4093, longitude: 49.8671 } }));
  const ImagePicker = require('expo-image-picker') as Record<string, unknown>;
  ImagePicker.launchCameraAsync = jest.fn(async () => ({ canceled: true, assets: null }));
}

jest.mock('@react-native-community/datetimepicker', () => {
  const React = require('react');
  const { View } = require('react-native');
  const Picker = (props: Record<string, unknown>) => React.createElement(View, { testID: props.testID ?? 'datetimepicker' });
  return { __esModule: true, default: Picker, DateTimePickerAndroid: { open: jest.fn(), dismiss: jest.fn(async () => true) } };
});

// The shared icon mock renders "icon:<name>"; give MaterialCommunityIcons its real glyph map so unknown category icons
// fall back exactly as on the device.
{
  const icons = require('@expo/vector-icons') as { MaterialCommunityIcons: { glyphMap?: Record<string, number> } };
  icons.MaterialCommunityIcons.glyphMap = require('@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/MaterialCommunityIcons.json');
}

// Test checkout (expo-web-browser auth session): tests set the result per case; the default is "closed by the user".
jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: jest.fn(async () => ({ type: 'cancel' })),
  openBrowserAsync: jest.fn(async () => ({ type: 'cancel' })),
  dismissAuthSession: jest.fn(),
  maybeCompleteAuthSession: jest.fn(() => ({ type: 'failed' })),
}));

// Push taps (expo-notifications responses): the shared mock has no response API. Tests capture the listener and set
// the cold-start response per case; by default nothing was tapped.
{
  const Notifications = require('expo-notifications') as Record<string, unknown>;
  Notifications.addNotificationResponseReceivedListener = jest.fn(() => ({ remove: jest.fn() }));
  Notifications.getLastNotificationResponseAsync = jest.fn(async () => null);
  Notifications.clearLastNotificationResponseAsync = jest.fn(async () => undefined);
}
