import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputInstance } from 'react-native';
import { colors, fonts, radii, spacing } from '../theme/tokens';

export const OTP_LENGTH = 6;

/** Keeps digits only (pasted "12 34 56", "Kod: 123456") and caps at `length`. */
export function sanitizeOtp(text: string, length = OTP_LENGTH): string {
  return (text ?? '').replace(/\D/g, '').slice(0, length);
}

export interface OtpInputProps {
  value: string;
  onChange: (code: string) => void;
  /** Called once when all digits are entered (auto-submit). */
  onComplete?: (code: string) => void;
  length?: number;
  error?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  testID?: string;
  accessibilityLabel?: string;
}

export interface OtpInputHandle {
  focus(): void;
  clear(): void;
}

/** Six boxes backed by one hidden input (so paste and SMS/WhatsApp autofill fill every box at once). Board 02 A2. */
export const OtpInput = forwardRef<OtpInputHandle, OtpInputProps>(function OtpInput(
  { value, onChange, onComplete, length = OTP_LENGTH, error, disabled, autoFocus = true, testID = 'otp-input', accessibilityLabel },
  ref,
) {
  const inputRef = useRef<TextInputInstance>(null);
  const [focused, setFocused] = useState(false);
  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    clear: () => onChange(''),
  }));

  const handleChange = (text: string) => {
    const code = sanitizeOtp(text, length);
    if (code === value) return;
    onChange(code);
    if (code.length === length) onComplete?.(code);
  };

  const boxes = Array.from({ length }, (_, i) => {
    const char = value[i] ?? '';
    const active = focused && (i === value.length || (i === length - 1 && value.length === length));
    return (
      <View
        key={i}
        testID={`${testID}-box-${i}`}
        style={[
          styles.box,
          char ? styles.filled : null,
          active ? styles.active : null,
          error ? styles.error : null,
        ]}
      >
        <Text style={styles.char}>{char}</Text>
      </View>
    );
  });

  return (
    <Pressable onPress={() => inputRef.current?.focus()} disabled={disabled} accessible={false}>
      <View style={styles.row}>{boxes}</View>
      <TextInput
        ref={inputRef}
        testID={testID}
        value={value}
        onChangeText={handleChange}
        maxLength={length * 4}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        autoFocus={autoFocus}
        editable={!disabled}
        caretHidden
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        accessibilityLabel={accessibilityLabel}
        style={styles.hidden}
      />
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  box: {
    flex: 1,
    maxWidth: 64,
    aspectRatio: 0.88,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filled: { borderColor: colors.border, backgroundColor: colors.surfaceMuted },
  active: { borderColor: colors.primary, borderWidth: 2 },
  error: { borderColor: colors.danger },
  char: { fontFamily: fonts.bold, fontSize: 24, color: colors.text },
  hidden: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.011, color: 'transparent' },
});
