import { asLocale, LOCALES, type Locale } from '@tezfiks/shared';

export const PANEL_LOCALES: readonly Locale[] = LOCALES;
export const PANEL_DEFAULT_LOCALE: Locale = 'az';
export const PANEL_TIME_ZONE = 'Asia/Baku';

/** Locale from the `locale` cookie; anything unknown falls back to az. */
export function resolveLocale(cookieValue: string | undefined | null): Locale {
  return cookieValue ? asLocale(cookieValue) : PANEL_DEFAULT_LOCALE;
}
