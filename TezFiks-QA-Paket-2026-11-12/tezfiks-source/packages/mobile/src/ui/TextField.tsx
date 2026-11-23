import React, { forwardRef, useState, type ReactNode } from 'react';
import { StyleSheet, TextInput, View, type TextInputInstance, type TextInputProps } from 'react-native';
import { colors, fonts, radii, spacing } from '../theme/tokens';
import { AppText } from './Text';

export interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  error?: string | null;
  hint?: string;
  left?: ReactNode;
  right?: ReactNode;
  dark?: boolean;
  multiline?: boolean;
}

/** Labelled input with error text. Azerbaijani text is passed through untouched (no autoCapitalize tricks). */
export const TextField = forwardRef<TextInputInstance, TextFieldProps>(function TextField(
  { label, error, hint, left, right, dark, multiline, onFocus, onBlur, ...rest },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const borderColor = error ? colors.danger : focused ? colors.primary : dark ? colors.darkSoft : colors.border;
  return (
    <View style={styles.wrap}>
      {label ? (
        <AppText variant="bodyStrong" color={dark ? 'textInverseMuted' : 'text'} style={styles.label}>
          {label}
        </AppText>
      ) : null}
      <View
        style={[
          styles.box,
          { borderColor, backgroundColor: dark ? colors.darkSoft : colors.surface },
          multiline ? styles.multiline : null,
        ]}
      >
        {left}
        <TextInput
          ref={ref}
          {...rest}
          multiline={multiline}
          placeholderTextColor={dark ? colors.textInverseMuted : colors.textMuted}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[styles.input, { color: dark ? colors.textInverse : colors.text }, multiline ? styles.inputMultiline : null]}
          accessibilityLabel={rest.accessibilityLabel ?? label}
        />
        {right}
      </View>
      {error ? (
        <AppText variant="caption" color="danger" style={styles.below} accessibilityLiveRegion="polite">
          {error}
        </AppText>
      ) : hint ? (
        <AppText variant="caption" color={dark ? 'textInverseMuted' : 'textMuted'} style={styles.below}>
          {hint}
        </AppText>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.md },
  label: { marginBottom: spacing.xs },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radii.md,
    minHeight: 52,
    paddingHorizontal: spacing.md,
  },
  multiline: { alignItems: 'flex-start', minHeight: 104, paddingVertical: spacing.sm },
  input: { flex: 1, fontFamily: fonts.regular, fontSize: 15, paddingVertical: spacing.sm },
  inputMultiline: { textAlignVertical: 'top' },
  below: { marginTop: spacing.xs },
});
