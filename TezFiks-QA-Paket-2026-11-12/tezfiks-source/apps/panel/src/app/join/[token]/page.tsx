import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Smartphone, Store, UserPlus, XCircle } from 'lucide-react';
import { api, ApiError, type EndpointOutput } from '@tezfiks/shared';
import { AuthCard } from '@/components/auth/auth-card';
import { buttonVariants } from '@/components/ui/button';
import { dateTimeText } from '@/lib/format';
import { PRO_APP_DOWNLOAD_URL } from '@/lib/env';
import { proInviteDeepLink } from '@/lib/nav';
import { serverApi } from '@/lib/session/server';

export const metadata: Metadata = { title: 'TezFiks Usta' };

type Preview = EndpointOutput<typeof api.invites.preview>;

async function loadPreview(token: string): Promise<Preview | null> {
  const client = await serverApi(null);
  try {
    return await client.call(api.invites.preview, { params: { token } });
  } catch (err) {
    // Unknown / malformed tokens are "not found"; API outages bubble up to the error page.
    if (err instanceof ApiError && err.status >= 400 && err.status < 500) return null;
    throw err;
  }
}

/** Public invite landing: "open the TezFiks Usta app" (deep link) + Play Store placeholder. */
export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const preview = await loadPreview(token);
  const t = await getTranslations();

  if (!preview || !preview.valid) {
    const reason = preview?.reason ?? 'NOT_FOUND';
    return (
      <AuthCard title={t('panel.join.invalidTitle')}>
        <div className="flex items-start gap-3 rounded-md bg-danger/8 p-3 text-sm text-danger">
          <XCircle className="mt-0.5 size-5 shrink-0" aria-hidden />
          <p>{t(`panel.join.reason.${reason}`)}</p>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t('panel.join.title', { company: preview.companyName })}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3 rounded-md bg-primary/8 p-3 text-sm">
          <UserPlus className="size-5 text-primary" aria-hidden />
          <div>
            <p className="font-semibold">
              {t('panel.join.role', { role: t(`common.companyRole.${preview.role}`) })}
            </p>
            <p className="text-muted-foreground">
              {t('panel.join.expires', { date: dateTimeText(preview.expiresAt) })}
            </p>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">{t('panel.join.instructions')}</p>
        <a href={proInviteDeepLink(token)} className={buttonVariants({ size: 'lg', className: 'w-full' })}>
          <Smartphone aria-hidden />
          {t('panel.join.openApp')}
        </a>
        <a
          href={PRO_APP_DOWNLOAD_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ variant: 'outline', size: 'lg', className: 'w-full' })}
        >
          <Store aria-hidden />
          {t('panel.join.getApp')}
        </a>
        <p className="text-center text-xs text-muted-foreground">{t('panel.join.storeSoon')}</p>
      </div>
    </AuthCard>
  );
}
