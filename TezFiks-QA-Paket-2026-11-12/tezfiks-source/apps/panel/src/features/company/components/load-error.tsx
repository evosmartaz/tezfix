'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ErrorState } from '@/components/states';
import { cn } from '@/lib/utils';
import type { CompanyLoadError as LoadErrorData } from '../load-types';

/**
 * Body of a company page section whose data could not be loaded. NOT_FOUND (unknown id, or an endpoint that is not
 * deployed yet) gets its own wording; everything else shows the API message. Retry re-renders the server component.
 */
export function CompanyLoadError({ error, className }: { error: LoadErrorData; className?: string }) {
  const t = useTranslations('panel.company.common');
  const router = useRouter();
  const notFound = error.code === 'NOT_FOUND';
  return (
    <div className={cn('rounded-lg border border-border bg-surface', className)} data-error-code={error.code}>
      <ErrorState
        title={notFound ? t('notFoundTitle') : undefined}
        message={notFound ? t('notFound') : error.message}
        onRetry={() => router.refresh()}
      />
    </div>
  );
}
