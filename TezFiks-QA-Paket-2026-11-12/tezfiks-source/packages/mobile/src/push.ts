import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { api, type ApiClient, type DevicePlatform, type PushProvider } from '@tezfiks/shared';
import { colors } from './theme/tokens';
import type { MobileApp } from './runtime';

/** Android notification channels (spec §11). */
export const NOTIFICATION_CHANNELS = {
  offers: 'offers_v1',
  default: 'default_v1',
} as const;

export interface ChannelNames {
  offers: string;
  default: string;
}

/** Creates the two Android channels; offers get max importance, sound and vibration. No-op elsewhere. */
export async function ensureNotificationChannels(names: ChannelNames): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(NOTIFICATION_CHANNELS.offers, {
    name: names.offers,
    importance: Notifications.AndroidImportance.MAX,
    sound: 'default',
    vibrationPattern: [0, 400, 200, 400],
    lightColor: colors.primary,
    enableVibrate: true,
  });
  await Notifications.setNotificationChannelAsync(NOTIFICATION_CHANNELS.default, {
    name: names.default,
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

export interface RegisterPushOptions {
  api: ApiClient;
  app: MobileApp;
  deviceId: string;
  channelNames: ChannelNames;
  /** Already asked the user for permission (e.g. the pro "device setup" screen); default true. */
  requestPermission?: boolean;
}

export type RegisterPushResult = { registered: boolean; pushToken: string | null; error?: string };

/**
 * Registers this device and its push token with the API (POST /me/devices). Every failure is non-fatal:
 * in development there is no Firebase config, so the token is null and the device is still registered.
 */
export async function registerForPush(opts: RegisterPushOptions): Promise<RegisterPushResult> {
  let pushToken: string | null = null;
  let pushProvider: PushProvider | null = null;
  let error: string | undefined;
  try {
    await ensureNotificationChannels(opts.channelNames);
    let perm = await Notifications.getPermissionsAsync();
    if (!perm.granted && perm.canAskAgain !== false && opts.requestPermission !== false) {
      perm = await Notifications.requestPermissionsAsync();
    }
    if (perm.granted) {
      const token = await Notifications.getDevicePushTokenAsync();
      if (typeof token.data === 'string' && token.data) {
        pushToken = token.data;
        pushProvider = 'FCM';
      }
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const platform: DevicePlatform = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'web' ? 'web' : 'android';
  try {
    await opts.api.call(api.me.registerDevice, {
      body: {
        deviceId: opts.deviceId,
        app: opts.app,
        platform,
        pushToken,
        pushProvider,
        appVersion: Constants.expoConfig?.version ?? undefined,
      },
    });
    return { registered: true, pushToken, error };
  } catch (err) {
    return { registered: false, pushToken, error: err instanceof Error ? err.message : String(err) };
  }
}
