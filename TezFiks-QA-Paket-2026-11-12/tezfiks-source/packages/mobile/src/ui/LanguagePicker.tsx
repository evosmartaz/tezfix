import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { Locale } from '@tezfiks/shared';
import { changeLanguage, SUPPORTED_LANGUAGES, useT } from '../i18n';
import { saveServerLocale } from '../localeSync';
import { useRuntime } from '../runtime';
import { colors, radii, spacing } from '../theme/tokens';
import { AppText } from './Text';

export interface LanguagePickerProps {
  dark?: boolean;
  /** "short" = AZ/RU/EN chips (welcome screen); "full" = Azərbaycanca/Русский/English. */
  mode?: 'short' | 'full';
  testID?: string;
}

/** Switches the UI language, persists it in SecureStore and (when signed in) saves it on the server for push texts. */
export function LanguagePicker({ dark, mode = 'short', testID = 'language-picker' }: LanguagePickerProps) {
  const { t, locale } = useT();
  const runtime = useRuntime();

  const select = async (lng: Locale) => {
    if (lng === locale) return;
    await changeLanguage(lng, runtime.storage);
    // Shares the request with useServerLocaleSync (which also reacts to the language change); a failure is not fatal:
    // the UI language already changed and the sync tries again on the next start.
    if (runtime.auth.getState().status === 'signedIn') await saveServerLocale(runtime, lng);
  };

  return (
    <View style={styles.row} testID={testID} accessibilityRole="radiogroup">
      {SUPPORTED_LANGUAGES.map((lng) => {
        const selected = lng === locale;
        const label = mode === 'short' ? lng.toUpperCase() : t(`common:languages.${lng}`);
        return (
          <Pressable
            key={lng}
            onPress={() => void select(lng)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={t(`common:languages.${lng}`)}
            testID={`${testID}-${lng}`}
            style={[
              styles.chip,
              { borderColor: selected ? colors.primary : dark ? colors.darkSoft : colors.border },
              selected ? { backgroundColor: dark ? colors.darkSoft : colors.primarySoft } : null,
            ]}
          >
            <AppText variant="small" style={{ fontFamily: 'Inter_600SemiBold' }} color={selected ? (dark ? 'primary' : 'primaryDark') : dark ? 'textInverseMuted' : 'textMuted'}>
              {label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.xs },
  chip: { borderWidth: 1, borderRadius: radii.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
});
