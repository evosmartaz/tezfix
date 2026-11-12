import type { ReactNode, SelectHTMLAttributes } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { TONE_CLASSES, type StatusTone } from '@/lib/status';
import { cn } from '@/lib/utils';

/** Native select styled like the panel inputs (keyboard friendly, no portal). */
export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'flex h-10 w-full rounded-md border border-input bg-surface px-3 text-sm text-foreground',
        'focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

/** Card section with a title row (detail pages). */
export function Section({
  title,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn('rounded-lg border border-border bg-surface shadow-xs', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      <div className={cn('p-5', bodyClassName)}>{children}</div>
    </section>
  );
}

export interface InfoItem {
  label: ReactNode;
  value: ReactNode;
}

/** Label / value grid. */
export function InfoList({ items, className }: { items: InfoItem[]; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2', className)}>
      {items.map((item, i) => (
        <div key={i} className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-xs text-muted-foreground">{item.label}</dt>
          <dd className="min-w-0 text-sm break-words text-foreground">{item.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export interface TabLink {
  key: string;
  label: ReactNode;
  count?: number | null;
  href: string;
  active: boolean;
}

/** Pill tabs as links (server filters such as Hamısı (312) / Təsdiq gözləyən (9) / Bloklanmış (4)). */
export function TabLinks({ tabs, className }: { tabs: TabLink[]; className?: string }) {
  return (
    <nav className={cn('flex flex-wrap items-center gap-2', className)} aria-label="tabs">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={tab.active ? 'page' : undefined}
          data-active={tab.active || undefined}
          className={cn(
            'inline-flex h-8 items-center rounded-full border border-border bg-surface px-4 text-xs font-semibold text-foreground transition-colors hover:bg-muted',
            tab.active && 'border-ink bg-ink text-white hover:bg-ink',
          )}
        >
          {tab.label}
          {typeof tab.count === 'number' ? ` (${tab.count})` : ''}
        </Link>
      ))}
    </nav>
  );
}

/** Small "Bax →" link used in table rows. */
export function RowLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="text-sm font-semibold whitespace-nowrap text-primary hover:underline">
      {children} →
    </Link>
  );
}

/** Rating as on board 05 ("★ 4.9" or "—"). */
export function Rating({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="whitespace-nowrap tabular-nums">
      <span className="text-accent">★</span> {value.toFixed(1)}
    </span>
  );
}

/** Thumbnails of signed file URLs (opens the full image in a new tab). */
export function PhotoGrid({
  files,
  alt,
  className,
}: {
  files: Array<{ id: string; url: string; contentType: string }>;
  alt: string;
  className?: string;
}) {
  if (files.length === 0) return <span className="text-sm text-muted-foreground">—</span>;
  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {files.map((f, i) => (
        <a
          key={f.id}
          href={f.url}
          target="_blank"
          rel="noreferrer"
          className="block size-24 overflow-hidden rounded-md border border-border bg-muted"
        >
          {f.contentType === 'application/pdf' ? (
            <span className="flex h-full items-center justify-center text-xs font-semibold text-muted-foreground">PDF</span>
          ) : (
            <img src={f.url} alt={`${alt} ${i + 1}`} className="h-full w-full object-cover" loading="lazy" />
          )}
        </a>
      ))}
    </div>
  );
}

/** Small grey "BOT" tag for simulator handymen/requests. */
export function BotTag({ label }: { label: ReactNode }) {
  return (
    <span className="ml-1.5 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-violet-700 uppercase">
      {label}
    </span>
  );
}

const DISPLAY_TONES: Record<string, StatusTone> = {
  ACTIVE: 'success',
  LOW_BALANCE: 'warning',
  PENDING: 'warning',
  BLOCKED: 'danger',
  REJECTED: 'danger',
  DRAFT: 'neutral',
};

/** Board 05 status column of the handymen list (Aktiv / Balans azdır / Təsdiq gözləyir / Bloklanmış ...). */
export function DisplayStatusBadge({ status }: { status: string }) {
  const t = useTranslations('panel.admin.enums.displayStatus');
  const tone = DISPLAY_TONES[status] ?? 'neutral';
  return (
    <Badge className={TONE_CLASSES[tone]} data-tone={tone} data-status={status}>
      {t.has(status) ? t(status) : status}
    </Badge>
  );
}
