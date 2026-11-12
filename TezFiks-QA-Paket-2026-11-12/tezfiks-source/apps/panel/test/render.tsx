import type { ReactElement, ReactNode } from 'react';
import { render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { panelMessages } from '@/i18n/messages';

/** Renders with the panel's intl provider (Baku time zone) and a fresh TanStack Query client. */
export function renderPanel(ui: ReactElement, locale = 'az') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <NextIntlClientProvider locale={locale} messages={panelMessages(locale)} timeZone="Asia/Baku">
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </NextIntlClientProvider>
    );
  }
  return { ...render(ui, { wrapper: Wrapper }), client };
}
