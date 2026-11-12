import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AuthCard } from '@/components/auth/auth-card';
import { CompanyLoginForm } from '@/components/auth/company-login-form';
import { safeNextPath } from '@/lib/session/cookies';
import { getCompanyUser } from '@/lib/session/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('panel.auth');
  return { title: t('companyTitle') };
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function CompanyLoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = first(params.next);
  let me = null;
  try {
    me = await getCompanyUser();
  } catch {
    me = null;
  }
  if (me) redirect(safeNextPath(next, 'company'));
  const t = await getTranslations('panel.auth');
  return (
    <AuthCard title={t('companyTitle')} subtitle={t('companySubtitle')}>
      <CompanyLoginForm next={next} notice={first(params.expired) ? t('sessionExpired') : undefined} />
    </AuthCard>
  );
}
