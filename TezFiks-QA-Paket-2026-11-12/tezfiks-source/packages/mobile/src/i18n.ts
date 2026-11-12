// Intl.PluralRules polyfill must load before i18next resolves plural forms (Hermes).
import 'intl-pluralrules';
import i18next, { type i18n as I18nInstance, type TFunction } from 'i18next';
import { initReactI18next, useTranslation } from 'react-i18next';
import * as Localization from 'expo-localization';
import { resources as allResources } from '@tezfiks/i18n';
import { DEFAULT_LOCALE, type Locale } from '@tezfiks/shared';
import { STORAGE_KEYS, type KeyValueStorage } from './storage';

export type AppNamespace = 'customer' | 'pro';
export const SUPPORTED_LANGUAGES: readonly Locale[] = ['az', 'ru', 'en'];

/** The app-wide i18next instance (react-i18next binds to it in initI18n). */
export const i18n: I18nInstance = i18next.createInstance();

export function isSupportedLanguage(value: unknown): value is Locale {
  return typeof value === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

/** Device language from expo-localization when supported, else az. */
export function detectDeviceLanguage(): Locale {
  try {
    for (const l of Localization.getLocales()) {
      const code = (l.languageCode ?? '').toLowerCase();
      if (isSupportedLanguage(code)) return code;
    }
  } catch {
    // fall through
  }
  return DEFAULT_LOCALE;
}

/** Saved language (SecureStore) → device language → az. */
export async function resolveInitialLanguage(storage: KeyValueStorage): Promise<Locale> {
  const saved = await storage.getItem(STORAGE_KEYS.language).catch(() => null);
  if (isSupportedLanguage(saved)) return saved;
  return detectDeviceLanguage();
}

export interface InitI18nOptions {
  appNamespace: AppNamespace;
  storage: KeyValueStorage;
  /** Skip storage/device detection (tests). */
  language?: Locale;
}

/**
 * Initializes i18next with `common` + the app namespace. Keys without a namespace prefix are looked up in the app
 * namespace first, then in `common` (e.g. t('auth.otpTitle'), t('actions.continue'), t('common:errors.NETWORK')).
 */
export async function initI18n(opts: InitI18nOptions): Promise<I18nInstance> {
  const lng = opts.language ?? (await resolveInitialLanguage(opts.storage));
  if (i18n.isInitialized) {
    if (i18n.language !== lng) await i18n.changeLanguage(lng);
    return i18n;
  }
  const resources: Record<string, Record<string, unknown>> = {};
  for (const l of SUPPORTED_LANGUAGES) {
    resources[l] = { common: allResources[l].common, [opts.appNamespace]: allResources[l][opts.appNamespace] };
  }
  await i18n.use(initReactI18next).init({
    resources: resources as never,
    lng,
    fallbackLng: DEFAULT_LOCALE,
    supportedLngs: [...SUPPORTED_LANGUAGES],
    ns: [opts.appNamespace, 'common'],
    defaultNS: opts.appNamespace,
    fallbackNS: 'common',
    interpolation: { escapeValue: false },
    returnNull: false,
    react: { useSuspense: false },
  });
  return i18n;
}

/** Changes the UI language and persists the choice. */
export async function changeLanguage(lng: Locale, storage: KeyValueStorage): Promise<void> {
  await i18n.changeLanguage(lng);
  await storage.setItem(STORAGE_KEYS.language, lng).catch(() => undefined);
}

/** Current UI language as an API locale (Accept-Language). */
export function currentLocale(): Locale {
  const lng = i18n.resolvedLanguage ?? i18n.language;
  return isSupportedLanguage(lng) ? lng : DEFAULT_LOCALE;
}

/** Returned before initI18n finished: renders nothing instead of crashing (i18next refuses t() before init). */
const notReadyT = ((..._args: unknown[]) => '') as unknown as TFunction;

/** Translate hook used by the UI kit and screens (safe before initialization; re-renders on language change). */
export function useT(): { t: TFunction; locale: Locale } {
  const { t, i18n: inst } = useTranslation(undefined, { i18n, useSuspense: false });
  const lng = inst.resolvedLanguage ?? inst.language;
  return { t: inst.isInitialized ? t : notReadyT, locale: isSupportedLanguage(lng) ? lng : DEFAULT_LOCALE };
}
