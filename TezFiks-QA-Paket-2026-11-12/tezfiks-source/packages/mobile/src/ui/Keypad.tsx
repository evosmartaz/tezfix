import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { applyKeypadKey, type KeypadKey, type KeypadOptions } from '../format';
import { colors, fonts, spacing } from '../theme/tokens';
import { AppText } from './Text';
import { useT } from '../i18n';

export interface KeypadProps extends KeypadOptions {
  /** Decimal amount string ("45.5"); convert with keypadToMinor. */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  testID?: string;
}

const ROWS: KeypadKey[][] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['.', '0', 'back'],
];

/** Numeric keypad of board 03 "İşi tamamla" (labour + materials entry). */
export function Keypad({ value, onChange, disabled, testID = 'keypad', ...opts }: KeypadProps) {
  const { t } = useT();
  return (
    <View testID={testID}>
      {ROWS.map((row, r) => (
        <View key={r} style={styles.row}>
          {row.map((key) => (
            <Pressable
              key={key}
              disabled={disabled}
              onPress={() => onChange(applyKeypadKey(value, key, opts))}
              style={({ pressed }) => [styles.key, pressed ? styles.pressed : null]}
              accessibilityRole="button"
              accessibilityLabel={key === 'back' ? t('common:actions.delete') : key}
              testID={`${testID}-${key}`}
            >
              {key === 'back' ? (
                <Ionicons name="backspace-outline" size={24} color={colors.text} />
              ) : (
                <AppText style={styles.label}>{key}</AppText>
              )}
            </Pressable>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  key: { flex: 1, height: 56, alignItems: 'center', justifyContent: 'center', borderRadius: 12, margin: spacing.xxs },
  pressed: { backgroundColor: colors.border },
  label: { fontFamily: fonts.semibold, fontSize: 24, color: colors.text },
});
