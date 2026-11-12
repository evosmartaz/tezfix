'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { FileRef } from '@tezfiks/shared';
import { cn } from '@/lib/utils';

/** New idempotency key (one per logical operation; reused on a retry of the same operation). */
export function newKey(prefix = 'p2'): string {
  const c = globalThis.crypto as Crypto | undefined;
  return c?.randomUUID ? c.randomUUID() : `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Round photo or initials. */
export function Avatar({
  name,
  photo,
  size = 'md',
  className,
}: {
  name: string;
  photo?: Pick<FileRef, 'url'> | null;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toLocaleUpperCase('az'))
    .join('');
  const dim = size === 'sm' ? 'size-8 text-xs' : 'size-10 text-sm';
  if (photo?.url) {
    return <img src={photo.url} alt="" className={cn('shrink-0 rounded-full object-cover', dim, className)} />;
  }
  return (
    <span
      aria-hidden
      className={cn('flex shrink-0 items-center justify-center rounded-full bg-muted font-semibold text-muted-foreground', dim, className)}
    >
      {initials || '?'}
    </span>
  );
}

export type WorkerPillState = 'free' | 'busy' | 'offline' | 'noTrade';

const PILL: Record<WorkerPillState, string> = {
  free: 'bg-primary/10 text-primary-strong',
  busy: 'bg-amber-100 text-amber-800',
  offline: 'bg-muted text-muted-foreground',
  noTrade: 'bg-danger/10 text-danger',
};

/** "Boşdur" / "Sifarişdədir" / "Oflayn" pill (board 04). */
export function WorkerPill({ state, className }: { state: WorkerPillState; className?: string }) {
  const t = useTranslations('panel.company.workerState');
  return (
    <span
      data-state={state}
      className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap', PILL[state], className)}
    >
      {t(state)}
    </span>
  );
}

/** Small amber warning line. */
export function Note({ children, tone = 'warning', className }: { children: ReactNode; tone?: 'warning' | 'info' | 'danger'; className?: string }) {
  const tones = {
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
    info: 'border-border bg-muted text-foreground',
    danger: 'border-danger/30 bg-danger/8 text-danger',
  };
  return <p className={cn('rounded-md border px-3 py-2 text-sm', tones[tone], className)}>{children}</p>;
}
