import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { formatMoney } from '@tezfiks/shared';
import { AppText, TextField, colors, radii, spacing, useT } from '@tezfiks/mobile';

export interface AmountValue {
  /** Selected preset (qəpik) or null when the custom field is used. */
  preset: number | null;
  custom: string;
}

export interface AmountPickerProps {
  presets: readonly number[];
  value: AmountValue;
  onChange: (v: AmountValue) => void;
  label: string;
  error?: string | null;
  testID: string;
}

/** Preset amount chips ("10 ₼", "20 ₼"...) plus a free amount field (top-up, tip). */
export function AmountPicker({ presets, value, onChange, label, error, testID }: AmountPickerProps) {
  const { locale } = useT();
  return (
    <View testID={testID}>
      <View style={styles.chips}>
        {presets.map((p) => {
          const selected = value.preset === p;
          return (
            <Pressable
              key={p}
              onPress={() => onChange({ preset: p, custom: '' })}
              style={[styles.chip, selected ? styles.chipOn : null]}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              testID={`${testID}-preset-${p}`}
            >
              <AppText variant="bodyStrong" color={selected ? 'primary' : 'text'}>
                {formatMoney(p, locale, { compact: true })}
              </AppText>
            </Pressable>
          );
        })}
      </View>
      <TextField
        label={label}
        value={value.custom}
        onChangeText={(text) => onChange({ preset: null, custom: text.replace(/[^\d.,]/g, '') })}
        keyboardType="decimal-pad"
        maxLength={9}
        error={error}
        testID={`${testID}-custom`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  // Equal boxes, 48 dp tall ("2 ₼ | 5 ₼ | 10 ₼"); the selected one is outlined in blue.
  chip: {
    flexGrow: 1,
    flexBasis: 0,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipOn: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
});
