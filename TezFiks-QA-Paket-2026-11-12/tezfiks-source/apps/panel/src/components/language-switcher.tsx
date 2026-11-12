'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Languages } from 'lucide-react';
import { LOCALES, type Locale } from '@tezfiks/shared';
import { setLocaleAction } from '@/lib/actions/auth';
import { cn } from '@/lib/utils';

/** az / ru / en switch in the header; the choice is kept in the `locale` cookie. */
export function LanguageSwitcher({
  className,
  tone = 'light',
}: {
  className?: string;
  tone?: 'light' | 'dark';
}) {
  const locale = useLocale();
  const t = useTranslations();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function choose(next: Locale) {
    if (next === locale) return;
    startTransition(async () => {
      await setLocaleAction(next);
      router.refresh();
    });
  }

  return (
    <div
      role="group"
      aria-label={t('panel.shell.language')}
      className={cn('inline-flex items-center gap-1', pending && 'opacity-60', className)}
    >
      <Languages
        className={cn('mr-1 size-4', tone === 'dark' ? 'text-white/60' : 'text-muted-foreground')}
        aria-hidden
      />
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => choose(l)}
          aria-pressed={l === locale}
          title={t(`common.languages.${l}`)}
          className={cn(
            'rounded px-2 py-1 text-xs font-semibold uppercase transition-colors',
            tone === 'dark'
              ? l === locale
                ? 'bg-white/15 text-white'
                : 'text-white/60 hover:text-white'
              : l === locale
                ? 'bg-ink text-white'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
