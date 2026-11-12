import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Building2, ShieldCheck } from 'lucide-react';
import { LanguageSwitcher } from '@/components/language-switcher';
import { getSession } from '@/lib/session/server';

/** /tezfix: signed-in users go to their panel; others choose admin or company login. */
export default async function HomePage() {
  const session = await getSession();
  if (session?.kind === 'admin') redirect('/admin');
  if (session?.kind === 'company') redirect('/company');
  const t = await getTranslations('panel.home');
  const items = [
    { href: '/admin/login', title: t('admin'), hint: t('adminHint'), icon: ShieldCheck },
    { href: '/company/login', title: t('company'), hint: t('companyHint'), icon: Building2 },
  ];
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 px-4 py-12">
      <div className="text-center">
        <div className="text-3xl font-bold tracking-tight text-ink">TezFiks</div>
        <h1 className="mt-2 text-lg font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>
      <div className="grid w-full max-w-xl gap-4 sm:grid-cols-2">
        {items.map(({ href, title, hint, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-5 shadow-xs transition-colors hover:border-primary"
          >
            <Icon className="size-6 text-primary" aria-hidden />
            <span className="font-semibold">{title}</span>
            <span className="text-sm text-muted-foreground">{hint}</span>
          </Link>
        ))}
      </div>
      <LanguageSwitcher />
    </main>
  );
}
