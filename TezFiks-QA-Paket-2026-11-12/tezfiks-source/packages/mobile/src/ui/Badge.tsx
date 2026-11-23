import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radii, spacing } from '../theme/tokens';
import { AppText } from './Text';

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'dark';

export const TONES: Record<Tone, { bg: string; fg: string; dot: string }> = {
  success: { bg: colors.primarySoft, fg: colors.primary, dot: colors.primary },
  warning: { bg: colors.accentSoft, fg: colors.accentText, dot: colors.accent },
  danger: { bg: colors.dangerSoft, fg: colors.danger, dot: colors.danger },
  info: { bg: colors.infoSoft, fg: colors.info, dot: colors.info },
  neutral: { bg: colors.surfaceMuted, fg: colors.textMuted, dot: colors.borderStrong },
  dark: { bg: colors.dark, fg: colors.textInverse, dot: colors.mint },
};

export interface BadgeProps {
  label: string;
  tone?: Tone;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Small rounded label ("Kontur MMC", "Qəbul üçün 30 saniyə"). One line; shrinks (with an ellipsis) in a tight row. */
export function Badge({ label, tone = 'neutral', style, testID }: BadgeProps) {
  const t = TONES[tone];
  return (
    <View style={[styles.badge, { backgroundColor: t.bg }, style]} testID={testID}>
      <AppText variant="caption" numberOfLines={1} style={[styles.label, { color: t.fg }]}>
        {label}
      </AppText>
    </View>
  );
}

/**
 * Pill with a status dot ("● ONLAYN", order statuses). On a narrow phone a long status ("Ожидает подтверждения цены")
 * shrinks to at most half of its row and ends with an ellipsis, so the name next to it stays visible; screen readers
 * still read the whole status.
 */
export function StatusPill({ label, tone = 'neutral', style, testID }: BadgeProps) {
  const t = TONES[tone];
  return (
    <View style={[styles.pill, { backgroundColor: t.bg }, style]} testID={testID} accessibilityRole="text" accessibilityLabel={label}>
      <View style={[styles.dot, { backgroundColor: t.dot }]} />
      <AppText variant="caption" numberOfLines={1} style={[styles.label, { color: t.fg }]}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignSelf: 'flex-start', flexShrink: 1, maxWidth: '100%', borderRadius: radii.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    flexShrink: 1,
    maxWidth: '50%',
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: spacing.xs, flexShrink: 0 },
  label: { fontFamily: 'Inter_600SemiBold', flexShrink: 1 },
});
