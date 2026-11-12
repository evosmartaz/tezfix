import type { ExpoConfig } from 'expo/config';

type PluginEntry = string | [string, Record<string, unknown>];

function load(env: Record<string, string | undefined> = {}): ExpoConfig {
  const saved = { ...process.env };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    let cfg!: ExpoConfig;
    jest.isolateModules(() => {
      const mod = require('../app.config');
      cfg = (mod.default ?? mod)({ config: {}, projectRoot: __dirname, staticConfigPath: null, packageJsonPath: null });
    });
    return cfg;
  } finally {
    process.env = saved;
  }
}

function plugin(cfg: ExpoConfig, name: string): Record<string, unknown> | true | undefined {
  for (const p of (cfg.plugins ?? []) as PluginEntry[]) {
    if (p === name) return true;
    if (Array.isArray(p) && p[0] === name) return p[1];
  }
  return undefined;
}

describe('pro app.config', () => {
  it('identifies the pro app', () => {
    const cfg = load({ EXPO_PUBLIC_API_URL: undefined, GOOGLE_MAPS_ANDROID_KEY: undefined });
    expect(cfg.name).toBe('TezFiks Usta');
    expect(cfg.scheme).toBe('tezfiksusta');
    expect(cfg.android?.package).toBe('az.tezfiks.usta');
  });

  it('points to the host API from the Android emulator by default and honours EXPO_PUBLIC_API_URL', () => {
    expect(load({ EXPO_PUBLIC_API_URL: undefined }).extra?.apiUrl).toBe('http://10.0.2.2:3000/tezfix/api');
    expect(load({ EXPO_PUBLIC_API_URL: 'https://evosmart.az/tezfix/api' }).extra?.apiUrl).toBe('https://evosmart.az/tezfix/api');
  });

  it('uses the Google Maps key when given, otherwise a placeholder and the OSM fallback flag', () => {
    const noKey = load({ GOOGLE_MAPS_ANDROID_KEY: undefined });
    expect(noKey.extra?.hasGoogleMapsKey).toBe(false);
    expect(noKey.android?.config?.googleMaps?.apiKey).toBeTruthy();
    expect(plugin(noKey, 'react-native-maps')).toEqual({ androidGoogleMapsApiKey: noKey.android?.config?.googleMaps?.apiKey });
    const withKey = load({ GOOGLE_MAPS_ANDROID_KEY: 'AIza-test' });
    expect(withKey.extra?.hasGoogleMapsKey).toBe(true);
    expect(withKey.android?.config?.googleMaps?.apiKey).toBe('AIza-test');
    expect(plugin(withKey, 'react-native-maps')).toEqual({ androidGoogleMapsApiKey: 'AIza-test' });
  });

  it('enables foreground location only (no background location permission)', () => {
    const cfg = load();
    expect(plugin(cfg, 'expo-location')).toMatchObject({ isAndroidForegroundServiceEnabled: true, isAndroidBackgroundLocationEnabled: false });
    expect(cfg.android?.blockedPermissions).toContain('android.permission.ACCESS_BACKGROUND_LOCATION');
    expect(cfg.android?.permissions ?? []).not.toContain('android.permission.ACCESS_BACKGROUND_LOCATION');
  });

  it('configures camera without audio, notifications, router, fonts and build properties', () => {
    const cfg = load();
    expect(plugin(cfg, 'expo-router')).toBe(true);
    expect(plugin(cfg, 'expo-font')).toBe(true);
    expect(plugin(cfg, '@tezfiks/mobile/plugins/with-windows-cmake')).toBe(true);
    expect(() => require.resolve('@tezfiks/mobile/plugins/with-windows-cmake')).not.toThrow();
    expect(plugin(cfg, 'expo-image-picker')).toBeTruthy();
    expect(plugin(cfg, 'expo-camera')).toMatchObject({ recordAudioAndroid: false });
    expect(cfg.android?.blockedPermissions).toContain('android.permission.RECORD_AUDIO');
    expect(plugin(cfg, 'expo-notifications')).toMatchObject({ defaultChannel: 'default_v1' });
    expect(plugin(cfg, 'expo-build-properties')).toEqual({
      android: expect.objectContaining({ targetSdkVersion: 36, minSdkVersion: 24 }),
    });
    expect(plugin(cfg, '@tezfiks/mobile/plugins/with-navigation-queries')).toBe(true);
    expect(() => require.resolve('@tezfiks/mobile/plugins/with-navigation-queries')).not.toThrow();
  });

  it('allows cleartext HTTP only for the dev API host, never globally', () => {
    // Plan M0: "Cleartext HTTP allowed for the dev API (http://10.0.2.2)". A global usesCleartextTraffic would let a
    // release build talk plain HTTP to any host.
    const dev = load({ EXPO_PUBLIC_API_URL: undefined });
    const props = plugin(dev, 'expo-build-properties') as { android: Record<string, unknown> };
    expect(props.android.usesCleartextTraffic).not.toBe(true);
    expect(plugin(dev, '@tezfiks/mobile/plugins/with-dev-cleartext')).toEqual({ apiUrl: 'http://10.0.2.2:3000/tezfix/api' });
    const nsc = require('@tezfiks/mobile/plugins/with-dev-cleartext') as { cleartextHosts(u: string): string[] };
    expect(nsc.cleartextHosts('http://10.0.2.2:3000/tezfix/api')).toContain('10.0.2.2');
    const prod = load({ EXPO_PUBLIC_API_URL: 'https://evosmart.az/tezfix/api' });
    const prodOpts = plugin(prod, '@tezfiks/mobile/plugins/with-dev-cleartext') as { apiUrl: string };
    expect(prodOpts.apiUrl).toBe('https://evosmart.az/tezfix/api');
    expect(nsc.cleartextHosts(prodOpts.apiUrl)).toEqual([]);
  });

  it('references brand icon and splash assets that exist', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const nodePath = require('node:path') as typeof import('node:path');
    const cfg = load();
    const splash = plugin(cfg, 'expo-splash-screen') as { image: string };
    for (const rel of [cfg.icon, cfg.android?.adaptiveIcon?.foregroundImage, splash.image]) {
      expect(typeof rel).toBe('string');
      expect(fs.existsSync(nodePath.join(__dirname, '..', rel as string))).toBe(true);
    }
  });

  it('signs release builds with the company release key plugin (BUG-003) and keeps the package id', () => {
    const cfg = load();
    expect(plugin(cfg, '@tezfiks/mobile/plugins/with-release-signing')).toBe(true);
    expect(cfg.android?.package).toBe('az.tezfiks.usta');
    // 0.1.0 (versionCode 1) was signed with the debug key; every later build must carry a higher versionCode.
    expect(cfg.android?.versionCode).toBeGreaterThanOrEqual(2);
  });
});
