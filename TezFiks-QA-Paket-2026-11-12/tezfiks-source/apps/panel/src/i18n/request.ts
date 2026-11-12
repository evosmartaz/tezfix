import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { LOCALE_COOKIE } from '../lib/session/cookies';
import { PANEL_TIME_ZONE, resolveLocale } from './config';
import { panelMessages } from './messages';

/** No locale in the URL: the `locale` cookie decides (az default), Baku time zone everywhere. */
export default getRequestConfig(async () => {
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  return {
    locale,
    messages: panelMessages(locale),
    timeZone: PANEL_TIME_ZONE,
  };
});
