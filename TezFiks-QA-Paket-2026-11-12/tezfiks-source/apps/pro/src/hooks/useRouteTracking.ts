import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useStore } from 'zustand';
import { api, type ProAssignment, type ProProfileResponse } from '@tezfiks/shared';
import { ensureLocationPermission, errorCodeOf, useApi, useAuth, useSocket, useSocketEvent, useT, useToast } from '@tezfiks/mobile';
import { attachTrackingSocket, currentFix, pushFix, routeAssignment, startRouteTracking, stopRouteTracking, trackingStore } from '../online/tracking';
import { wantsRouteTracking, type JobRole } from '../lib/jobs';
import { qk } from './queries';

type T = (key: string, vars?: Record<string, unknown>) => string;

/** Foreground-service notification while reporting: "Aktiv sifariş" from acceptance, "Yoldasınız" once en route. */
export function routeNotification(t: T, phase: RoutePhase = 'enRoute') {
  return { title: t(phase === 'accepted' ? 'job.route.acceptedTitle' : 'job.route.title'), body: t('job.route.body') };
}

export type RoutePhase = 'accepted' | 'enRoute';

export function onlineNotification(t: T) {
  return { title: t('online.serviceTitle'), body: t('online.serviceBody') };
}

/** True when the pro is online for offers (presence pings continue after the route ends). */
function isOnlineFromCache(data: ProProfileResponse | undefined): boolean {
  const p = data?.profile;
  return !!p && p.status === 'APPROVED' && p.isOnline;
}

/** Starts the 5 s reporting for a job (from acceptance, after "Yola çıxdım", or when a live job is opened after a restart). */
/** False when location permission is refused (the caller tells the pro). Concurrent calls for one job share a start. */
export function beginRoute(assignmentId: string, t: T, phase: RoutePhase = 'enRoute'): Promise<boolean> {
  const pending = startingRoutes.get(assignmentId);
  if (pending) return pending;
  const run = (async () => {
    if ((await ensureLocationPermission()) !== 'granted') return false;
    await startRouteTracking(assignmentId, routeNotification(t, phase));
    const fix = await currentFix(4000);
    if (fix) pushFix(fix);
    return true;
  })().finally(() => startingRoutes.delete(assignmentId));
  startingRoutes.set(assignmentId, run);
  return run;
}

const startingRoutes = new Map<string, Promise<boolean>>();

/**
 * Keeps route reporting in line with the job the screen shows: EN_ROUTE → reporting with the assignment id;
 * anything else (arrived, cancelled, completed) → back to presence pings (online) or nothing (offline).
 */
export function useJobRouteTracking(a: ProAssignment | null | undefined, role: JobRole): void {
  const { t } = useT();
  const queryClient = useQueryClient();
  const tRef = useRef<T>(t as T);
  tRef.current = t as T;
  const id = a?.id ?? null;
  const wants = wantsRouteTracking(a, role);
  const phase: RoutePhase = a?.status === 'ACCEPTED' ? 'accepted' : 'enRoute';
  const toast = useToast();
  useEffect(() => {
    if (!id) return;
    if (wants && routeAssignment() !== id) {
      // Reporting now starts by itself; without location permission the pro must learn at once that they are invisible.
      void beginRoute(id, tRef.current, phase).then((ok) => {
        if (!ok) toast.show(tRef.current('job.route.permissionDenied'), { kind: 'error' });
      });
    } else if (!wants && routeAssignment() === id) {
      const online = isOnlineFromCache(queryClient.getQueryData<ProProfileResponse>(qk.profile));
      void stopRouteTracking(id, { online, notification: onlineNotification(tRef.current) });
    }
  }, [id, wants, queryClient]);
}

/**
 * App-level guard (root layout): while a route is reported it watches that assignment (socket `assignment:updated`
 * plus a slow poll) and ends route reporting once the job leaves ACCEPTED/EN_ROUTE or can no longer be read by this pro
 * (404/403 after a company reassign), even when the job screen is closed.
 */
export function useRouteTrackingGuard(): void {
  const client = useApi();
  // Pings go over the session socket whichever screen is open (the home screen may never have been mounted).
  const socket = useSocket();
  useEffect(() => {
    attachTrackingSocket(socket);
  }, [socket]);
  const queryClient = useQueryClient();
  const { t } = useT();
  const signedIn = useAuth((s) => s.status === 'signedIn');
  const routeId = useStore(trackingStore, (s) => s.assignmentId);
  const job = useQuery({
    queryKey: qk.assignment(routeId ?? 'none'),
    enabled: signedIn && !!routeId,
    refetchInterval: 30_000,
    queryFn: () => client.call(api.pro.assignment, { params: { id: routeId! } }),
  });
  useSocketEvent('assignment:updated', (p) => {
    if (p.assignmentId === routeAssignment()) void queryClient.invalidateQueries({ queryKey: qk.assignment(p.assignmentId) });
  });
  const status = job.data?.id === routeId ? job.data?.status : undefined;
  // Reassigned by the company manager (or otherwise taken away): the job is no longer readable, while react-query
  // keeps the last data (ACCEPTED). Without this the old worker's phone would report its position forever.
  // Only a settled answer counts: a cached error from an earlier route of the same job is being re-checked first.
  const gone = job.isError && job.fetchStatus === 'idle' && isGoneError(job.error);
  const tRef = useRef<T>(t as T);
  tRef.current = t as T;
  useEffect(() => {
    if (!routeId) return;
    if (!gone && (!status || status === 'EN_ROUTE' || status === 'ACCEPTED')) return;
    const online = isOnlineFromCache(queryClient.getQueryData<ProProfileResponse>(qk.profile));
    void stopRouteTracking(routeId, { online, notification: onlineNotification(tRef.current) });
  }, [routeId, status, gone, queryClient]);
}

/** The reported job no longer belongs to this pro (404/403); network errors and 5xx keep the reporting. */
export function isGoneError(err: unknown): boolean {
  const code = errorCodeOf(err);
  const status = (err as { status?: unknown } | null)?.status;
  return code === 'NOT_FOUND' || code === 'FORBIDDEN' || status === 404 || status === 403;
}
