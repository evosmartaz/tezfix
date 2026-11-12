import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

/** Minimal async key-value storage (SecureStore in the app, in-memory in tests). */
export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export const STORAGE_KEYS = {
  refreshToken: 'tf.refreshToken',
  deviceId: 'tf.deviceId',
  language: 'tf.language',
} as const;

/** expo-secure-store backed storage (Android Keystore). Keys may contain only [A-Za-z0-9._-]. */
export const secureStorage: KeyValueStorage = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  removeItem: (key) => SecureStore.deleteItemAsync(key),
};

export function createMemoryStorage(initial: Record<string, string> = {}): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: async (key) => data.get(key) ?? null,
    setItem: async (key, value) => {
      data.set(key, value);
    },
    removeItem: async (key) => {
      data.delete(key);
    },
  };
}

function newDeviceId(): string {
  try {
    return Crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

/** Stable per-install device id (sent with OTP verify, refresh and device registration). */
export async function getOrCreateDeviceId(storage: KeyValueStorage): Promise<string> {
  const existing = await storage.getItem(STORAGE_KEYS.deviceId).catch(() => null);
  if (existing && existing.length >= 8) return existing;
  const id = newDeviceId();
  await storage.setItem(STORAGE_KEYS.deviceId, id).catch(() => undefined);
  return id;
}
