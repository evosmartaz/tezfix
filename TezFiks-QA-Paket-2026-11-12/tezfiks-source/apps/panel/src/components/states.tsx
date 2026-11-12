'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Inbox } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface EmptyStateProps {
  title?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ title, description, icon, action, className }: EmptyStateProps) {
  const t = useTranslations('common.states');
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 px-6 py-12 text-center', className)}>
      <div className="mb-1 rounded-full bg-muted p-3 text-muted-foreground [&_svg]:size-6">
        {icon ?? <Inbox />}
      </div>
      <p className="text-sm font-semibold text-foreground">{title ?? t('empty')}</p>
      {description ? <p className="max-w-md text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export interface ErrorStateProps {
  title?: ReactNode;
  /** Error message (already translated). */
  message?: ReactNode;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({ title, message, onRetry, className }: ErrorStateProps) {
  const t = useTranslations('common');
  return (
    <div
      role="alert"
      className={cn('flex flex-col items-center justify-center gap-2 px-6 py-12 text-center', className)}
    >
      <div className="mb-1 rounded-full bg-danger/10 p-3 text-danger [&_svg]:size-6">
        <AlertTriangle />
      </div>
      <p className="text-sm font-semibold text-foreground">{title ?? t('states.error')}</p>
      {message ? <p className="max-w-md text-sm text-muted-foreground">{message}</p> : null}
      {onRetry ? (
        <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
          {t('actions.retry')}
        </Button>
      ) : null}
    </div>
  );
}
