import { useCallback, useEffect, useRef } from 'react';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { qk } from '../data/queries';
import { pushTapHref, type PushTap } from '../lib/notifications';

type Subscription = { remove: () => void };

/**
 * Opens the screen a tapped push is about (price proposed → payment, chat message → chat, project news → project, ...),
 * the same target as a tap in the in-app list. `enabled` is true once the user is signed in and past onboarding:
 * a tap that arrives earlier (cold start from a push, or while the session is restoring) waits until then.
 * Each push is handled once, even if the app asks the OS for the last response again after a re-login.
 */
export function usePushTapRouting(enabled: boolean): void {
  const queryClient = useQueryClient();
  const pending = useRef<string | null>(null);
  const handled = useRef(new Set<string>());
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const open = useCallback(
    (href: string) => {
      void queryClient.invalidateQueries({ queryKey: qk.notificationsRoot });
      router.push(href as never);
    },
    [queryClient],
  );

  const take = useCallback(
    (tap: PushTap | null | undefined) => {
      if (!tap) return;
      const key = tap.notification?.request?.identifier;
      if (key) {
        if (handled.current.has(key)) return;
        handled.current.add(key);
      }
      const href = pushTapHref(tap);
      if (!href) return;
      if (enabledRef.current) open(href);
      else pending.current = href;
    },
    [open],
  );

  // Taps while the app runs (foreground or background).
  useEffect(() => {
    let sub: Subscription | null = null;
    try {
      sub = Notifications.addNotificationResponseReceivedListener((r) => take(r as unknown as PushTap)) as Subscription;
    } catch {
      sub = null;
    }
    return () => sub?.remove();
  }, [take]);

  // The tap that started the app, then anything that waited for the sign-in.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      try {
        const last = await Notifications.getLastNotificationResponseAsync();
        if (cancelled) return;
        take(last as unknown as PushTap | null);
        if (last) await Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
      } catch {
        // No native module (tests, web) or nothing to read: nothing to open.
      }
      if (cancelled || !pending.current) return;
      const href = pending.current;
      pending.current = null;
      open(href);
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, take, open]);
}
