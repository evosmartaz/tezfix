/* Jest setup for @tezfiks/mobile: deterministic stand-ins for native Expo modules. */

// On the device, uploads use React Native's FormData (file parts are { uri, name, type }). Jest's Node environment
// would otherwise provide undici's FormData, which stringifies such parts.
(globalThis as { FormData: unknown }).FormData = require('react-native/Libraries/Network/FormData').default;

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    __store: store,
    getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => {
      store.set(k, v);
    }),
    deleteItemAsync: jest.fn(async (k: string) => {
      store.delete(k);
    }),
  };
});

jest.mock('expo-crypto', () => {
  let n = 0;
  return { randomUUID: jest.fn(() => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`) };
});

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageCode: 'az', languageTag: 'az-AZ' }]),
}));

jest.mock('expo-network', () => ({
  addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })),
  getNetworkStateAsync: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '0.1.0', extra: { apiUrl: 'http://10.0.2.2:3000/tezfix/api', hasGoogleMapsKey: false } } },
}));

jest.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 5, HIGH: 6, MAX: 7 },
  setNotificationChannelAsync: jest.fn(async () => null),
  getPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted', canAskAgain: true })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted', canAskAgain: true })),
  getDevicePushTokenAsync: jest.fn(async () => {
    throw new Error('Default FirebaseApp is not initialized');
  }),
}));

jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: jest.fn(async () => ({ granted: false, status: 'undetermined', canAskAgain: true })),
  requestForegroundPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted', canAskAgain: true })),
}));

jest.mock('expo-camera', () => ({
  Camera: {
    getCameraPermissionsAsync: jest.fn(async () => ({ granted: false, status: 'denied', canAskAgain: false })),
    requestCameraPermissionsAsync: jest.fn(async () => ({ granted: false, status: 'denied', canAskAgain: false })),
  },
}));

jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true, assets: null })),
}));

jest.mock('expo-image-manipulator', () => {
  /** Source pixel sizes by uri (tests set them); unknown uris decode as 4000x3000. */
  const sizes = new Map<string, { width: number; height: number }>();
  let n = 0;
  const manipulate = jest.fn((uri: string) => {
    const size = { ...(sizes.get(uri) ?? { width: 4000, height: 3000 }) };
    const context: { resize: jest.Mock; renderAsync: jest.Mock; release: jest.Mock } = {
      resize: jest.fn((r: { width?: number; height?: number }) => {
        const ratio = r.width ? r.width / size.width : (r.height as number) / size.height;
        size.width = Math.round(size.width * ratio);
        size.height = Math.round(size.height * ratio);
        return context;
      }),
      renderAsync: jest.fn(async () => {
        const snapshot = { ...size };
        return {
          width: snapshot.width,
          height: snapshot.height,
          release: jest.fn(),
          saveAsync: jest.fn(async (opts: { compress?: number; format?: string }) => ({
            uri: `file:///cache/manipulated-${++n}.${opts.format === 'png' ? 'png' : 'jpg'}`,
            width: snapshot.width,
            height: snapshot.height,
          })),
        };
      }),
      release: jest.fn(),
    };
    return context;
  });
  return { __sizes: sizes, ImageManipulator: { manipulate }, SaveFormat: { JPEG: 'jpeg', PNG: 'png', WEBP: 'webp' } };
});

jest.mock('react-native-maps', () => {
  const React = require('react');
  const { View } = require('react-native');
  const mk = (name: string) => {
    const C = React.forwardRef((props: Record<string, unknown>, ref: unknown) =>
      React.createElement(View, { ...props, ref, testID: (props.testID as string) ?? name }),
    );
    C.displayName = name;
    return C;
  };
  return {
    __esModule: true,
    default: mk('MapView'),
    Marker: mk('Marker'),
    Polygon: mk('Polygon'),
    Polyline: mk('Polyline'),
    UrlTile: mk('UrlTile'),
    PROVIDER_GOOGLE: 'google',
  };
});

jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  const Icon = (props: { name: string; testID?: string }) => React.createElement(Text, { testID: props.testID }, `icon:${props.name}`);
  return { Ionicons: Icon, MaterialIcons: Icon, MaterialCommunityIcons: Icon };
});
