import type { ConfigContext, ExpoConfig } from 'expo/config';

/** Android emulator → host machine API (spec §13: EXPO_PUBLIC_API_URL overrides). */
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:3000/tezfix/api';
const MAPS_KEY = process.env.GOOGLE_MAPS_ANDROID_KEY || null;
/**
 * The Maps SDK crashes at MapView creation when the manifest has no API key, so builds without a key get a
 * placeholder and the app renders OpenStreetMap tiles instead (extra.hasGoogleMapsKey = false).
 */
const MAPS_KEY_OR_PLACEHOLDER = MAPS_KEY ?? 'NO_GOOGLE_MAPS_KEY_OSM_FALLBACK';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'TezFiks Usta',
  slug: 'tezfiks-usta',
  scheme: 'tezfiksusta',
  version: '0.1.1',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  icon: './assets/icon.png',
  backgroundColor: '#F5F7FC',
  platforms: ['android', 'ios'],
  android: {
    package: 'az.tezfiks.usta',
    versionCode: 2,
    adaptiveIcon: { foregroundImage: './assets/adaptive-icon.png', backgroundColor: '#0B1A5C' },
    softwareKeyboardLayoutMode: 'resize',
    config: { googleMaps: { apiKey: MAPS_KEY_OR_PLACEHOLDER } },
    permissions: ['android.permission.INTERNET', 'android.permission.ACCESS_NETWORK_STATE'],
    blockedPermissions: ['android.permission.ACCESS_BACKGROUND_LOCATION', 'android.permission.RECORD_AUDIO'],
  },
  ios: { bundleIdentifier: 'az.tezfiks.usta', supportsTablet: false },
  plugins: [
    'expo-router',
    [
      'expo-location',
      {
        isAndroidForegroundServiceEnabled: true,
        isAndroidBackgroundLocationEnabled: false,
        isIosBackgroundLocationEnabled: false,
        locationAlwaysAndWhenInUsePermission: false,
        locationAlwaysPermission: false,
      },
    ],
    ['expo-camera', { recordAudioAndroid: false, microphonePermission: false }],
    ['expo-image-picker', { microphonePermission: false }],
    ['expo-notifications', { color: '#2F5BFF', defaultChannel: 'default_v1' }],
    ['react-native-maps', { androidGoogleMapsApiKey: MAPS_KEY_OR_PLACEHOLDER }],
    [
      'expo-build-properties',
      {
        android: {
          targetSdkVersion: 36,
          minSdkVersion: 24,
          // Release builds are minified (R8); without these rules WorkManager's Room database is stripped and the app crashes at start.
          extraProguardRules: [
            '-keep class * extends androidx.room.RoomDatabase { <init>(); }',
            '-keep class androidx.work.impl.WorkDatabase_Impl { *; }',
          ].join('\n'),
        },
      },
    ],
    'expo-font',
    'expo-secure-store',
    'expo-localization',
    '@tezfiks/mobile/plugins/with-windows-cmake',
    // Cleartext HTTP only for the dev API host (network security config), never globally.
    ['@tezfiks/mobile/plugins/with-dev-cleartext', { apiUrl: API_URL }],
    '@tezfiks/mobile/plugins/with-navigation-queries',
    // BUG-003: release APKs are signed with the company release key (TEZFIKS_RELEASE_* env), never the debug key.
    '@tezfiks/mobile/plugins/with-release-signing',
    ['expo-splash-screen', { backgroundColor: '#0B1A5C', image: './assets/splash-icon.png', imageWidth: 120 }],
  ],
  experiments: { typedRoutes: false },
  extra: {
    apiUrl: API_URL,
    hasGoogleMapsKey: MAPS_KEY !== null,
  },
});
