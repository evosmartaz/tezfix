import { Injectable } from '@nestjs/common';
import { translate } from '@tezfiks/i18n/server';
import type { Locale } from '@tezfiks/shared';

/** Server-side translations: keys like "common.errors.NOT_FOUND" or "server.<module>.<key>". */
@Injectable()
export class I18nService {
  t(locale: Locale | string, key: string, vars?: Record<string, string | number>): string {
    return translate(locale, key, vars);
  }
}
