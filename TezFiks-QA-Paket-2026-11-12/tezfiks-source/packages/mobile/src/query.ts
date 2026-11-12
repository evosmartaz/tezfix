import { AppState, Platform, type AppStateStatus } from 'react-native';
import * as Network from 'expo-network';
import { focusManager, onlineManager, QueryClient } from '@tanstack/react-query';
import { isAuthError } from './errors';

/** QueryClient defaults for mobile: modest retries, never retry auth/validation errors. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        gcTime: 5 * 60_000,
        retry: (failureCount, error) => {
          if (isAuthError(error)) return false;
          const status = (error as { status?: number })?.status ?? 0;
          if (status >= 400 && status < 500) return false;
          return failureCount < 2;
        },
        refetchOnReconnect: true,
        refetchOnWindowFocus: true,
      },
      mutations: { retry: false },
    },
  });
}

/** Maps an AppState change to react-query focus (active = focused). */
export function onAppStateChange(status: AppStateStatus): void {
  if (Platform.OS !== 'web') focusManager.setFocused(status === 'active');
}

let managersConfigured = false;

/**
 * Wires TanStack Query to React Native: online state from expo-network, focus from AppState.
 * Idempotent; returns a cleanup for tests.
 */
export function configureQueryManagers(): () => void {
  if (managersConfigured) return () => undefined;
  managersConfigured = true;
  onlineManager.setEventListener((setOnline) => {
    let sub: { remove(): void } | undefined;
    try {
      sub = Network.addNetworkStateListener((state) => {
        setOnline(state.isConnected !== false && state.isInternetReachable !== false);
      });
    } catch {
      sub = undefined;
    }
    return () => sub?.remove();
  });
  const appStateSub = AppState.addEventListener('change', onAppStateChange);
  return () => {
    appStateSub.remove();
    managersConfigured = false;
  };
}
