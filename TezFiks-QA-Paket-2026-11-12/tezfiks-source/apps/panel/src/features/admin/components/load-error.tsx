'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ErrorState } from '@/components/states';
import type { AdminLoadError } from '../load-types';

/**
 * Page body when its data could not be loaded. NOT_FOUND (unknown id, or an admin endpoint that is not deployed yet)
 * gets its own wording; everything else shows the API message. Retry re-renders the server component.
 */
export function LoadError({ error }: { error: AdminLoadError }) {
  const t = useTranslations('panel.admin.common');
  const router = useRouter();
  const notFound = error.code === 'NOT_FOUND';
  return (
    <div className="rounded-lg border border-border bg-surface" data-error-code={error.code}>
      <ErrorState
        title={notFound ? t('notFoundTitle') : undefined}
        message={notFound ? t('notFound') : error.message}
        onRetry={() => router.refresh()}
      />
    </div>
  );
}
