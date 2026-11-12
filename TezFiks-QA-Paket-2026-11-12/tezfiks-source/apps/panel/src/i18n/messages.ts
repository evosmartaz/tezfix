/**
 * Translations come from `@tezfiks/i18n` in i18next format (`{{var}}`, plural keys `x_one` / `x_few` / `x_other`), shared with
 * the mobile apps and the API. next-intl expects ICU MessageFormat, so the panel converts once per locale:
 *   "{{name}} gəldi"                       -> "{name} gəldi"
 *   { minutes_one, minutes_other }         -> { minutes: "{count, plural, one {# dəq} other {# dəq}}" }
 * ICU syntax characters in plain text (apostrophe, braces, '<') are quoted so they render literally.
 */
import { resources, type Messages } from '@tezfiks/i18n';
import { asLocale, type Locale } from '@tezfiks/shared';

export const PANEL_NAMESPACES = ['common', 'panel'] as const;
export type PanelNamespace = (typeof PANEL_NAMESPACES)[number];

const PLURAL_SUFFIXES = ['zero', 'one', 'two', 'few', 'many', 'other'] as const;
const PLURAL_RE = /^(.+)_(zero|one|two|few|many|other)$/;

/** Escapes ICU syntax in literal text, then turns i18next `{{var}}` placeholders into ICU arguments. */
export function i18nextToIcu(text: string, pluralVar?: string): string {
  const parts = text.split(/(\{\{\s*[A-Za-z0-9_]+\s*\}\})/g);
  return parts
    .map((part) => {
      const m = /^\{\{\s*([A-Za-z0-9_]+)\s*\}\}$/.exec(part);
      if (m) return pluralVar && m[1] === pluralVar ? '#' : `{${m[1]}}`;
      // In ICU a single quote starts quoting; double it. Braces, '#' (inside plurals) and '<' (rich-text tags) are quoted.
      return part
        .replace(/'/g, "''")
        .replace(/([{}<]+)/g, "'$1'")
        .replace(/#/g, pluralVar ? "'#'" : '#');
    })
    .join('');
}

/** Converts a whole (nested) message tree. */
export function toIcuMessages(tree: Messages): Messages {
  const out: Messages = {};
  const plurals = new Map<string, Partial<Record<(typeof PLURAL_SUFFIXES)[number], string>>>();
  for (const [key, value] of Object.entries(tree)) {
    if (typeof value !== 'string') {
      out[key] = toIcuMessages(value);
      continue;
    }
    const m = PLURAL_RE.exec(key);
    if (m) {
      const forms = plurals.get(m[1]) ?? {};
      forms[m[2] as (typeof PLURAL_SUFFIXES)[number]] = value;
      plurals.set(m[1], forms);
      continue;
    }
    out[key] = i18nextToIcu(value);
  }
  for (const [base, forms] of plurals) {
    if (!forms.other) {
      // Not a real plural group (e.g. a key that merely ends in "_one"): keep the keys as they are.
      for (const [suffix, text] of Object.entries(forms))
        out[`${base}_${suffix}`] = i18nextToIcu(text as string);
      continue;
    }
    const branches = PLURAL_SUFFIXES.filter((s) => forms[s] !== undefined)
      .map((s) => `${s === 'zero' ? '=0' : s} {${i18nextToIcu(forms[s] as string, 'count')}}`)
      .join(' ');
    out[base] = `{count, plural, ${branches}}`;
  }
  return out;
}

const cache = new Map<Locale, Record<PanelNamespace, Messages>>();

/** ICU messages for the panel: `common` (shared labels, errors, statuses) and `panel`. */
export function panelMessages(locale: string): Record<PanelNamespace, Messages> {
  const lng = asLocale(locale);
  const cached = cache.get(lng);
  if (cached) return cached;
  const messages = {
    common: toIcuMessages(resources[lng].common),
    panel: toIcuMessages(resources[lng].panel),
  };
  cache.set(lng, messages);
  return messages;
}
