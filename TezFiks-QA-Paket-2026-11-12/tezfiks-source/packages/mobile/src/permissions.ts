import { Linking } from 'react-native';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { Camera } from 'expo-camera';

/**
 * granted  permission available
 * denied   refused this time (can ask again)
 * blocked  refused permanently: only the system settings can change it
 */
export type PermissionResult = 'granted' | 'denied' | 'blocked';

interface PermissionLike {
  granted?: boolean;
  status?: string;
  canAskAgain?: boolean;
}

export function toPermissionResult(p: PermissionLike | null | undefined): PermissionResult {
  if (!p) return 'denied';
  if (p.granted || p.status === 'granted') return 'granted';
  return p.canAskAgain === false ? 'blocked' : 'denied';
}

async function ensure(get: () => Promise<PermissionLike>, request: () => Promise<PermissionLike>): Promise<PermissionResult> {
  try {
    const current = await get();
    if (toPermissionResult(current) === 'granted') return 'granted';
    if (current.canAskAgain === false) return 'blocked';
    return toPermissionResult(await request());
  } catch {
    return 'denied';
  }
}

/** Foreground location only (the apps never request ACCESS_BACKGROUND_LOCATION). */
export function ensureLocationPermission(): Promise<PermissionResult> {
  return ensure(Location.getForegroundPermissionsAsync, Location.requestForegroundPermissionsAsync);
}

export function ensureNotificationPermission(): Promise<PermissionResult> {
  return ensure(Notifications.getPermissionsAsync, () => Notifications.requestPermissionsAsync());
}

/** Camera without microphone (KYC selfies and photos). */
export function ensureCameraPermission(): Promise<PermissionResult> {
  return ensure(Camera.getCameraPermissionsAsync, Camera.requestCameraPermissionsAsync);
}

/** Opens this app's page in the system settings (after a "blocked" result). */
export function openAppSettings(): Promise<void> {
  return Linking.openSettings();
}
