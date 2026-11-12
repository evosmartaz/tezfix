import React from 'react';
import { Pressable, ScrollView, StyleSheet } from 'react-native';
import type { ProProfileResponse } from '@tezfiks/shared';
import { AppText, colors, radii, spacing, useT } from '@tezfiks/mobile';
import { canSwitchMode, setPreferredMode, type ProMode } from '../lib/mode';

export interface ModeSwitcherProps {
  profile: ProProfileResponse | null | undefined;
  mode: ProMode;
  dark?: boolean;
  testID?: string;
}

/** Personal ↔ company (manager) mode chips; hidden when only one mode exists. */
export function ModeSwitcher({ profile, mode, dark, testID = 'mode-switcher' }: ModeSwitcherProps) {
  const { t } = useT();
  if (!canSwitchMode(profile)) return null;
  const options: Array<{ key: string; label: string; mode: ProMode }> = [];
  if (profile?.profile) options.push({ key: 'personal', label: t('mode.personal'), mode: { kind: 'personal' } });
  for (const c of profile?.managedCompanies ?? []) {
    options.push({ key: c.id, label: t('mode.company', { name: c.name }), mode: { kind: 'company', companyId: c.id } });
  }
  const selectedKey = mode.kind === 'company' ? mode.companyId : 'personal';
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} testID={testID}>
      {options.map((o) => {
        const on = o.key === selectedKey;
        return (
          <Pressable
            key={o.key}
            onPress={() => setPreferredMode(o.mode)}
            style={[styles.chip, dark ? styles.chipDark : null, on ? styles.chipOn : null]}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            testID={`mode-${o.key}`}
          >
            <AppText variant="small" color={on || dark ? 'textInverse' : 'text'}>
              {o.label}
            </AppText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: spacing.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radii.pill, backgroundColor: colors.surface, marginRight: spacing.sm, borderWidth: 1, borderColor: colors.border },
  chipDark: { backgroundColor: colors.darkSoft, borderColor: colors.darkSoft },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
});
