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

/*
 * Pro-app native modules beyond the shared mocks. jest.doMock (not hoisted) runs after the shared setup import, so these
 * factories replace the shared ones for expo-location, expo-camera and expo-notifications.
 */

jest.doMock('expo-location', () => ({
  Accuracy: { Lowest: 1, Low: 2, Balanced: 3, High: 4, Highest: 5, BestForNavigation: 6 },
  getForegroundPermissionsAsync: jest.fn(async () => ({ granted: false, status: 'undetermined', canAskAgain: true })),
  requestForegroundPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted', canAskAgain: true })),
  getCurrentPositionAsync: jest.fn(async () => ({
    coords: { latitude: 40.4093, longitude: 49.8671, accuracy: 10, heading: -1, speed: -1, altitude: 0, altitudeAccuracy: 0 },
    timestamp: Date.now(),
  })),
  getLastKnownPositionAsync: jest.fn(async () => null),
  watchPositionAsync: jest.fn(async () => ({ remove: jest.fn() })),
  startLocationUpdatesAsync: jest.fn(async () => undefined),
  stopLocationUpdatesAsync: jest.fn(async () => undefined),
  hasStartedLocationUpdatesAsync: jest.fn(async () => false),
}));

jest.mock('expo-task-manager', () => {
  const tasks = new Map<string, Function>();
  return {
    __tasks: tasks,
    defineTask: jest.fn((name: string, fn: Function) => tasks.set(name, fn)),
    isTaskDefined: jest.fn((name: string) => tasks.has(name)),
  };
});

jest.doMock('expo-camera', () => {
  const React = require('react');
  const { View } = require('react-native');
  let n = 0;
  const takePictureAsync = jest.fn(async () => ({ uri: `file:///camera/shot-${++n}.jpg`, width: 3000, height: 4000 }));
  const CameraView = React.forwardRef((props: Record<string, unknown>, ref: unknown) => {
    React.useImperativeHandle(ref, () => ({ takePictureAsync }));
    return React.createElement(View, { testID: (props.testID as string) ?? 'camera-view', facing: props.facing });
  });
  return {
    __takePictureAsync: takePictureAsync,
    CameraView,
    Camera: {
      getCameraPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted', canAskAgain: true })),
      requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted', canAskAgain: true })),
    },
  };
});

jest.doMock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 5, HIGH: 6, MAX: 7 },
  setNotificationChannelAsync: jest.fn(async () => null),
  getPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted', canAskAgain: true })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted', canAskAgain: true })),
  getDevicePushTokenAsync: jest.fn(async () => {
    throw new Error('Default FirebaseApp is not initialized');
  }),
  setNotificationHandler: jest.fn(),
  scheduleNotificationAsync: jest.fn(async () => 'local-1'),
  dismissNotificationAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-device', () => ({ manufacturer: 'samsung', brand: 'samsung', modelName: 'Galaxy A54' }));

jest.mock('@react-native-community/slider', () => {
  const React = require('react');
  const { View } = require('react-native');
  const Slider = (props: Record<string, unknown>) => React.createElement(View, { testID: props.testID, accessibilityValue: { now: props.value } });
  return { __esModule: true, default: Slider };
});

