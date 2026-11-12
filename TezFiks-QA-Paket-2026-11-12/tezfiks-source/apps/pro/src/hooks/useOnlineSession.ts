import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useStore } from 'zustand';
import { api, type ProProfile } from '@tezfiks/shared';
import {
  ensureLocationPermission,
  errorMessage,
  openAppSettings,
  useApi,
  useAuth,
  useSocket,
  useT,
  useToast,
} from '@tezfiks/mobile';
import {
  attachTrackingSocket,
  currentFix,
  isTracking,
  pushFix,
  routeAssignment,
  startOnlineTracking,
  stopOnlineTracking,
  trackingStore,
} from '../online/tracking';
import { qk } from './queries';

export type OnlineWarning = 'LOW_BALANCE' | 'NO_TRADES' | 'COMPANY_LOW_BALANCE';

export interface OnlineSession {
  online: boolean;
  busy: boolean;
  warnings: OnlineWarning[];
  /** Last known own position (map marker). */
  position: { lat: number; lng: number } | null;
  setOnline(next: boolean): Promise<void>;
}

/**
 * ONLAYN/OFLAYN (board 03 B1): POST /pro/online, then location pings while online (foreground service, 15 s,
 * `pro:location` over the socket, REST fallback). Resumes tracking when the server says the pro is still online
 * (app restart) and stops it when the server turns the pro offline (block, sweep).
 */
export function useOnlineSession(profile: ProProfile | null | undefined): OnlineSession {
  const client = useApi();
  const socket = useSocket();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { t } = useT();
  const [online, setOnlineState] = useState<boolean>(!!profile?.isOnline);
  const [busy, setBusy] = useState(false);
  const [warnings, setWarnings] = useState<OnlineWarning[]>([]);
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    attachTrackingSocket(socket);
  }, [socket]);

  const serviceText = useCallback(() => ({ title: tRef.current('online.serviceTitle'), body: tRef.current('online.serviceBody') }), []);

  // Follow the server state (profile refetches). A profile that is no longer APPROVED (blocked, worker removed from
  // the company) is never online, whatever the stale flag says.
  const serverOnline = profile ? profile.status === 'APPROVED' && profile.isOnline : undefined;
  useEffect(() => {
    if (serverOnline === undefined || busy) return;
    setOnlineState(serverOnline);
    if (serverOnline && !isTracking()) {
      void (async () => {
        if ((await ensureLocationPermission()) !== 'granted') return;
        await startOnlineTracking(serviceText());
        const fix = await currentFix(4000);
        if (fix) {
          pushFix(fix);
          setPosition({ lat: fix.lat, lng: fix.lng });
        }
      })();
    } else if (!serverOnline && isTracking() && !routeAssignment()) {
      // an offline pro driving to a job keeps reporting the route (lane M4 en-route tracking)
      void stopOnlineTracking();
    }
    // busy is deliberately excluded: a toggle in flight decides itself
  }, [serverOnline, serviceText]);

  const setOnline = useCallback(
    async (next: boolean) => {
      if (busy) return;
      setBusy(true);
      try {
        if (next) {
          const perm = await ensureLocationPermission();
          if (perm !== 'granted') {
            toast.show(t('online.locationRequired'), {
              kind: 'error',
              ...(perm === 'blocked' ? { actionLabel: t('common:actions.openSettings'), onAction: () => void openAppSettings() } : {}),
            });
            return;
          }
          const fix = await currentFix();
          if (fix) setPosition({ lat: fix.lat, lng: fix.lng });
          const res = await client.call(api.pro.setOnline, { body: { online: true, ...(fix ? { location: { lat: fix.lat, lng: fix.lng } } : {}) } });
          setOnlineState(res.isOnline);
          setWarnings(res.warnings);
          if (res.isOnline) {
            await startOnlineTracking(serviceText());
            if (fix) pushFix(fix);
          }
        } else {
          const res = await client.call(api.pro.setOnline, { body: { online: false } });
          setOnlineState(res.isOnline);
          setWarnings([]);
          if (!routeAssignment()) await stopOnlineTracking();
        }
        void queryClient.invalidateQueries({ queryKey: qk.profile });
      } catch (err) {
        toast.show(errorMessage(t, err), { kind: 'error' });
      } finally {
        setBusy(false);
      }
    },
    [busy, client, queryClient, serviceText, t, toast],
  );

  return { online, busy, warnings, position, setOnline };
}

/**
 * App-level stop for location reporting (mounted in the root layout, independent of which screen is showing). While
 * tracking runs it keeps an active GET /pro/profile observer, so `profile:updated` refetches it even when the home
 * screen is not mounted, and it stops the foreground service, the tick timer and the pings when:
 * - the handyman profile is gone or no longer APPROVED (admin block, worker removed from the company → DRAFT), or
 * - the server turns the pro offline (online → offline transition: block, presence sweep, offline elsewhere).
 * Sign-out is handled by the root layout.
 */
export function useTrackingGuard(): void {
  const client = useApi();
  const signedIn = useAuth((s) => s.status === 'signedIn');
  const tracking = useStore(trackingStore, (s) => s.mode !== 'none');
  const profile = useQuery({ queryKey: qk.profile, queryFn: () => client.call(api.pro.profile), enabled: signedIn && tracking });
  const loaded = profile.data !== undefined;
  const pro = profile.data?.profile ?? null;
  const approved = !!pro && pro.status === 'APPROVED';
  const serverOnline = pro ? approved && pro.isOnline : false;

  useEffect(() => {
    if (tracking && loaded && !approved) void stopOnlineTracking();
  }, [tracking, loaded, approved]);

  const prevOnline = useRef<boolean | null>(null);
  useEffect(() => {
    const prev = prevOnline.current;
    prevOnline.current = loaded ? serverOnline : null;
    if (prev === true && loaded && !serverOnline && isTracking() && !routeAssignment()) void stopOnlineTracking();
  }, [loaded, serverOnline]);
}
