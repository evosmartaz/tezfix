import type { ReactNode } from 'react';
import { LanguageSwitcher } from '@/components/language-switcher';

/** Centered card used by the login pages and the invite landing. */
export function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-background px-4 py-12">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-8 shadow-sm">
        <div className="mb-6">
          <div className="text-2xl font-bold tracking-tight text-ink">
            Tez<span className="text-primary">Fiks</span>
          </div>
          <h1 className="mt-4 text-lg font-semibold">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
        </div>
        {children}
      </div>
      <LanguageSwitcher />
    </main>
  );
}
