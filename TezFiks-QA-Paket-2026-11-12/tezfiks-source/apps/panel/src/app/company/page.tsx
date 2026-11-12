import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Building2, ChevronRight } from 'lucide-react';
import { AuthCard } from '@/components/auth/auth-card';
import { StatusBadge } from '@/components/status-badge';
import { buttonVariants } from '@/components/ui/button';
import { logoutAction } from '@/lib/actions/auth';
import { managedCompanies, requireCompanyUser } from '@/lib/session/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('panel.auth');
  return { title: t('chooseCompanyTitle') };
}

/** Company chooser: companies where the signed-in user is MANAGER (one company -> straight in). */
export default async function CompanyChooserPage() {
  const { me } = await requireCompanyUser();
  const companies = managedCompanies(me);
  if (companies.length === 1) redirect(`/company/${companies[0].companyId}`);
  const t = await getTranslations('panel');
  return (
    <AuthCard
      title={t('auth.chooseCompanyTitle')}
      subtitle={companies.length ? t('auth.chooseCompanySubtitle') : undefined}
    >
      {companies.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('auth.noManagedCompanies')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {companies.map((c) => (
            <li key={c.companyId}>
              <Link
                href={`/company/${c.companyId}`}
                className="flex items-center gap-3 rounded-lg border border-border p-3 transition-colors hover:border-primary"
              >
                <Building2 className="size-5 text-primary" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{c.companyName}</span>
                  <StatusBadge family="verificationStatus" status={c.companyStatus} className="mt-1" />
                </span>
                <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <form action={logoutAction} className="mt-6">
        <button type="submit" className={buttonVariants({ variant: 'outline', className: 'w-full' })}>
          {t('shell.logout')}
        </button>
      </form>
    </AuthCard>
  );
}
