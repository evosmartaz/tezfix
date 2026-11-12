'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useRealtime, useSocketEvent } from '@/lib/realtime/realtime-provider';

export interface AdminLiveRefreshProps {
  /** Only refresh for these `admin:event` types (leading-word match, case and separator insensitive; see matchesAdminEvent). All when omitted. */
  types?: readonly string[];
  /** Also refresh on a timer (ms). */
  intervalMs?: number;
  /** Debounce for bursts of events (ms). */
  debounceMs?: number;
}

/** Lower-case words of an event type: 'KYC_SUBMITTED', 'kyc.submitted' and 'kyc-submitted' all give 'kyc_submitted'. */
function normalizeEventType(type: string): string {
  return type
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Whether an admin event type matches the filter: the event's leading word(s) must equal a filter entry, ignoring case
 * and the separator ('kyc' matches 'kyc.submitted' and the API's 'KYC_SUBMITTED'; 'company' matches
 * 'COMPANY_KYC_SUBMITTED'; 'kyc' does not match 'COMPANY_KYC_SUBMITTED' or 'kycx').
 */
export function matchesAdminEvent(type: string, filter?: readonly string[]): boolean {
  if (!filter || filter.length === 0) return true;
  const t = normalizeEventType(type);
  return filter.some((f) => {
    const p = normalizeEventType(f);
    return p.length > 0 && (t === p || t.startsWith(`${p}_`));
  });
}

/** Re-renders the current admin page (server data) on `admin:event` socket events, reconnects and an optional timer. */
export function AdminLiveRefresh({ types, intervalMs, debounceMs = 800 }: AdminLiveRefreshProps) {
  const router = useRouter();
  const { connectionEpoch } = useRealtime();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function schedule() {
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      router.refresh();
    }, debounceMs);
  }

  useSocketEvent('admin:event', (e) => {
    if (matchesAdminEvent(e.type, types)) schedule();
  });

  // Refetch after a reconnect (events may have been missed); the first connect needs no refresh.
  const seenEpoch = useRef(connectionEpoch);
  useEffect(() => {
    if (connectionEpoch > 1 && connectionEpoch !== seenEpoch.current) schedule();
    seenEpoch.current = connectionEpoch;
  }, [connectionEpoch]);

  useEffect(() => {
    if (!intervalMs) return;
    const id = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') router.refresh();
    }, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, router]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return null;
}
