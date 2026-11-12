import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** Buttons on the right. */
  actions?: ReactNode;
  /** Back link / breadcrumbs above the title. */
  breadcrumb?: ReactNode;
  className?: string;
}

export function PageHeader({ title, description, actions, breadcrumb, className }: PageHeaderProps) {
  return (
    <div className={cn('mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="flex min-w-0 flex-col gap-1">
        {breadcrumb ? <div className="text-sm text-muted-foreground">{breadcrumb}</div> : null}
        <h1 className="truncate text-2xl font-bold tracking-tight text-foreground">{title}</h1>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
