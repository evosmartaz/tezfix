'use client';

import { useTranslations } from 'next-intl';
import { ErrorState } from '@/components/states';

/** Route-level error boundary (API down, unexpected failures). */
export default function RouteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('panel.errorPage');
  return (
    <ErrorState title={t('title')} message={t('description')} onRetry={reset} className="min-h-[50dvh]" />
  );
}
