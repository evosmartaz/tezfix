import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { buttonVariants } from '@/components/ui/button';

export default async function NotFound() {
  const t = await getTranslations('panel.errorPage');
  return (
    <main className="flex min-h-[60dvh] flex-col items-center justify-center gap-3 px-4 text-center">
      <div className="text-5xl font-bold text-ink">404</div>
      <h1 className="text-lg font-semibold">{t('notFoundTitle')}</h1>
      <p className="max-w-md text-sm text-muted-foreground">{t('notFoundDescription')}</p>
      <Link href="/" className={buttonVariants({ variant: 'outline' })}>
        {t('backHome')}
      </Link>
    </main>
  );
}
