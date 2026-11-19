import React, { forwardRef } from 'react';
import { StyleSheet, TextInput, View, type TextInputInstance } from 'react-native';
import { AZ_COUNTRY_PREFIX, azDigitsToE164, formatAzNational, sanitizeAzPhoneDigits } from '../format';
import { colors, fonts, radii, spacing } from '../theme/tokens';
import { AppText } from './Text';

export interface PhoneInputProps {
  /** National digits shown after the +994 chip, e.g. "501234567". */
  value: string;
  /** New digits plus the normalized E.164 number (null until valid). */
  onChange: (digits: string, e164: string | null) => void;
  label?: string;
  error?: string | null;
  placeholder?: string;
  dark?: boolean;
  autoFocus?: boolean;
  onSubmitEditing?: () => void;
  testID?: string;
  /** Screen-reader label when no visible label is shown. */
  accessibilityLabel?: string;
}

/** Next digits for a text change; handles as-you-type formatting, deleting a separator, and pasting full numbers. */
export function nextPhoneDigits(prevDigits: string, text: string): string {
  const plus = text.lastIndexOf('+');
  const source = plus >= 0 ? text.slice(plus) : text;
  const digits = sanitizeAzPhoneDigits(source);
  const prevFormatted = formatAzNational(prevDigits);
  // Backspace over a space: the digits did not change but the text got shorter → drop the last digit.
  if (digits === prevDigits && text.length < prevFormatted.length) return prevDigits.slice(0, -1);
  return digits;
}

/** "+994" chip + national number formatted as "50 123 45 67" (board 02 A1). */
export const PhoneInput = forwardRef<TextInputInstance, PhoneInputProps>(function PhoneInput(
  { value, onChange, label, error, placeholder = '50 123 45 67', dark, autoFocus, onSubmitEditing, testID = 'phone-input', accessibilityLabel },
  ref,
) {
  return (
    <View style={styles.wrap}>
      {label ? (
        <AppText variant="small" color={dark ? 'textInverseMuted' : 'textMuted'} style={styles.label}>
          {label}
        </AppText>
      ) : null}
      <View
        style={[
          styles.box,
          {
            backgroundColor: dark ? colors.darkSoft : colors.surface,
            borderColor: error ? colors.danger : dark ? colors.darkSoft : colors.primary,
          },
        ]}
      >
        <View style={[styles.chip, { backgroundColor: dark ? colors.dark : colors.background }]} testID={`${testID}-chip`}>
          <AppText variant="bodyStrong" color={dark ? 'textInverse' : 'text'}>
            {AZ_COUNTRY_PREFIX}
          </AppText>
        </View>
        <TextInput
          ref={ref}
          testID={testID}
          value={formatAzNational(value)}
          onChangeText={(text) => {
            const digits = nextPhoneDigits(value, text);
            onChange(digits, azDigitsToE164(digits));
          }}
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          autoComplete="tel"
          autoFocus={autoFocus}
          maxLength={20}
          placeholder={placeholder}
          placeholderTextColor={dark ? colors.textInverseMuted : colors.textMuted}
          onSubmitEditing={onSubmitEditing}
          returnKeyType="done"
          accessibilityLabel={accessibilityLabel ?? label}
          style={[styles.input, { color: dark ? colors.textInverse : colors.text }]}
        />
      </View>
      {error ? (
        <AppText variant="caption" color="danger" style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </AppText>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.md },
  label: { marginBottom: spacing.xs },
  box: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderRadius: 14, height: 52, paddingLeft: spacing.md },
  chip: { borderRadius: radii.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, marginRight: spacing.sm },
  input: { flex: 1, fontFamily: fonts.regular, fontSize: 14, letterSpacing: 0, paddingVertical: spacing.sm },
  error: { marginTop: spacing.xs },
});
