'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useRealtime, useSocketEvent } from '@/lib/realtime/realtime-provider';
import { isCompanyWalletEvent, isForCompany } from '../dispatch';

export type CompanyLiveTopic = 'offers' | 'assignments' | 'workers' | 'wallet';

export interface CompanyLiveRefreshProps {
  companyId: string;
  /** Socket topics that re-render the page (server data). */
  topics: readonly CompanyLiveTopic[];
  /** Also refresh on a timer (ms) while the tab is visible. */
  intervalMs?: number;
  debounceMs?: number;
}

/**
 * Re-renders the current company page on this company's socket events (the manager's socket is in every managed
 * company's room, so events of other companies are ignored), after a reconnect and on an optional timer.
 */
export function CompanyLiveRefresh({ companyId, topics, intervalMs, debounceMs = 600 }: CompanyLiveRefreshProps) {
  const router = useRouter();
  const { connectionEpoch } = useRealtime();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const has = (t: CompanyLiveTopic) => topics.includes(t);

  function schedule() {
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      router.refresh();
    }, debounceMs);
  }

  useSocketEvent('offer:new', (o) => {
    if (has('offers') && isForCompany(o, companyId)) schedule();
  });
  useSocketEvent('offer:closed', () => {
    if (has('offers')) schedule();
  });
  useSocketEvent('assignment:updated', () => {
    // The payload carries no company id; the refetch is scoped to this company anyway.
    if (has('assignments')) schedule();
  });
  useSocketEvent('company:workers', (p) => {
    if (has('workers') && isForCompany(p, companyId)) schedule();
  });
  useSocketEvent('wallet:updated', (p) => {
    if (has('wallet') && isCompanyWalletEvent(p, companyId)) schedule();
  });

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
