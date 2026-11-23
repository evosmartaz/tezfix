import React, { type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radii, spacing, typography } from '../theme/tokens';
import { AppText } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'dark' | 'outline' | 'ghost' | 'danger' | 'dangerOutline' | 'dangerText' | 'accent';
export type ButtonSize = 'md' | 'lg' | 'sm';

export interface ButtonProps {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  accessibilityHint?: string;
}

const VARIANTS: Record<ButtonVariant, { bg: string; fg: string; border?: string; pressed: string; filled: boolean }> = {
  primary: { bg: colors.primary, fg: colors.textInverse, pressed: colors.primaryDark, filled: true },
  secondary: { bg: colors.primarySoft, fg: colors.primary, pressed: colors.primaryHalo, filled: true },
  dark: { bg: colors.dark, fg: colors.textInverse, pressed: colors.darkSoft, filled: true },
  outline: { bg: colors.surface, fg: colors.text, border: colors.border, pressed: colors.background, filled: false },
  ghost: { bg: 'transparent', fg: colors.primary, pressed: colors.primarySoft, filled: false },
  danger: { bg: colors.danger, fg: colors.textInverse, pressed: '#A92B39', filled: true },
  /** Red outline ("Sifarişi ləğv et", UX-C07). */
  dangerOutline: { bg: colors.surface, fg: colors.danger, border: colors.danger, pressed: colors.dangerSoft, filled: false },
  /** Red text action without a frame (pro "Sifarişi ləğv et", UX-P07). */
  dangerText: { bg: 'transparent', fg: colors.danger, pressed: colors.dangerSoft, filled: false },
  accent: { bg: colors.accent, fg: colors.dark, pressed: '#D98A06', filled: true },
};

const HEIGHTS: Record<ButtonSize, number> = { sm: 40, md: 52, lg: 56 };

/**
 * Rounded button (blue primary "Davam et", navy "Naviqasiyanı aç", outline "İmtina et"). A disabled filled button
 * turns grey with a muted label instead of fading, so it keeps >= 3:1 contrast (UX-C15).
 */
export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  loading,
  disabled,
  icon,
  fullWidth = true,
  style,
  testID,
  accessibilityHint,
}: ButtonProps) {
  const base = VARIANTS[variant];
  const greyedOut = !!disabled && !loading && base.filled;
  const v = greyedOut ? { ...base, bg: colors.disabled, fg: colors.textMuted, border: undefined } : base;
  const inactive = disabled || loading;
  return (
    <Pressable
      onPress={inactive ? undefined : onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      testID={testID}
      style={({ pressed }) => [
        styles.base,
        { height: HEIGHTS[size], backgroundColor: pressed && !inactive ? v.pressed : v.bg },
        v.border ? { borderWidth: 1, borderColor: v.border } : null,
        fullWidth ? styles.full : styles.inline,
        disabled && !loading && !greyedOut ? styles.disabled : null,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.fg} testID={testID ? `${testID}-loading` : undefined} />
      ) : (
        <View style={styles.row}>
          {icon ? <View style={styles.icon}>{icon}</View> : null}
          {/* Two lines, so a long label in a half-width button wraps instead of being cut (BUG-006). */}
          <AppText style={[size === 'sm' ? typography.small : typography.button, styles.label, { color: v.fg }]} numberOfLines={2}>
            {title}
          </AppText>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
  },
  full: { alignSelf: 'stretch' },
  inline: { alignSelf: 'flex-start' },
  disabled: { opacity: 0.5 },
  row: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
  icon: { marginRight: spacing.sm },
  label: { fontFamily: typography.button.fontFamily, textAlign: 'center', flexShrink: 1 },
});
