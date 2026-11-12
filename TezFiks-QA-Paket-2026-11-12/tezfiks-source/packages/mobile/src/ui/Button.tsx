import React, { type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radii, spacing, typography } from '../theme/tokens';
import { AppText } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'dark' | 'outline' | 'ghost' | 'danger' | 'accent';
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

const VARIANTS: Record<ButtonVariant, { bg: string; fg: string; border?: string; pressed: string }> = {
  primary: { bg: colors.primary, fg: colors.textInverse, pressed: colors.primaryDark },
  secondary: { bg: colors.primarySoft, fg: colors.primaryDark, pressed: '#D3F0E4' },
  dark: { bg: colors.dark, fg: colors.textInverse, pressed: colors.darkSoft },
  outline: { bg: colors.surface, fg: colors.text, border: colors.borderStrong, pressed: colors.background },
  ghost: { bg: 'transparent', fg: colors.primary, pressed: colors.primarySoft },
  danger: { bg: colors.danger, fg: colors.textInverse, pressed: '#C93C41' },
  accent: { bg: colors.accent, fg: colors.dark, pressed: '#DB8A06' },
};

const HEIGHTS: Record<ButtonSize, number> = { sm: 36, md: 48, lg: 56 };

/** Rounded button (green primary "Davam et", dark "Naviqasiyanı aç", outline "İmtina et"). */
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
  const v = VARIANTS[variant];
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
        disabled && !loading ? styles.disabled : null,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.fg} testID={testID ? `${testID}-loading` : undefined} />
      ) : (
        <View style={styles.row}>
          {icon ? <View style={styles.icon}>{icon}</View> : null}
          <AppText style={[size === 'sm' ? typography.small : typography.button, styles.label, { color: v.fg }]} numberOfLines={1}>
            {title}
          </AppText>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: radii.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  full: { alignSelf: 'stretch' },
  inline: { alignSelf: 'flex-start' },
  disabled: { opacity: 0.45 },
  row: { flexDirection: 'row', alignItems: 'center' },
  icon: { marginRight: spacing.sm },
  label: { fontFamily: typography.button.fontFamily },
});
