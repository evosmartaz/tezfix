import { useTranslations } from 'next-intl';
import { Construction } from 'lucide-react';
import { PageHeader } from '@/components/page-header';

/** Temporary page body for nav items whose screens are built by lanes P1 (admin) and P2 (company). */
export function PlaceholderPage({ titleKey }: { titleKey: string }) {
  const t = useTranslations();
  return (
    <div>
      <PageHeader title={t(titleKey)} />
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-surface px-6 py-16 text-center">
        <Construction className="size-8 text-muted-foreground" aria-hidden />
        <p className="text-sm font-semibold">{t('panel.placeholder.title')}</p>
        <p className="text-sm text-muted-foreground">{t('panel.placeholder.description')}</p>
      </div>
    </div>
  );
}
