import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AdminLoginForm } from '@/components/auth/admin-login-form';
import { AuthCard } from '@/components/auth/auth-card';
import { safeNextPath } from '@/lib/session/cookies';
import { getAdmin } from '@/lib/session/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('panel.auth');
  return { title: t('adminTitle') };
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = first(params.next);
  let admin = null;
  try {
    admin = await getAdmin();
  } catch {
    admin = null; // API unreachable: still show the form.
  }
  if (admin) redirect(safeNextPath(next, 'admin'));
  const t = await getTranslations('panel.auth');
  return (
    <AuthCard title={t('adminTitle')} subtitle={t('adminSubtitle')}>
      <AdminLoginForm next={next} notice={first(params.expired) ? t('sessionExpired') : undefined} />
    </AuthCard>
  );
}
