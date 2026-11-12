import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type StatTone = 'primary' | 'ink' | 'accent' | 'danger';

const VALUE_TONE: Record<StatTone, string> = {
  primary: 'text-primary',
  ink: 'text-ink',
  accent: 'text-accent',
  danger: 'text-danger',
};

export interface StatCardProps {
  label: ReactNode;
  value: ReactNode;
  /** Small line under the value ("+12% dünənlə müqayisədə", "onlayn: 34"). */
  hint?: ReactNode;
  tone?: StatTone;
  icon?: ReactNode;
  className?: string;
}

/** KPI tile (board 05: Bugünkü sifarişlər, Aktiv ustalar, Bugünkü gəlir, Ləğv nisbəti). */
export function StatCard({ label, value, hint, tone = 'ink', icon, className }: StatCardProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-1 rounded-lg border border-border bg-surface p-5 shadow-xs',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{label}</span>
        {icon ? <span className="text-muted-foreground [&_svg]:size-4">{icon}</span> : null}
      </div>
      <div className={cn('text-3xl font-bold tracking-tight tabular-nums', VALUE_TONE[tone])}>{value}</div>
      {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}
