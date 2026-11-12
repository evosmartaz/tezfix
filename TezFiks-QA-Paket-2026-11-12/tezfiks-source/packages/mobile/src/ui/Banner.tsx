import React, { type ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { radii, spacing } from '../theme/tokens';
import { TONES, type Tone } from './Badge';
import { AppText } from './Text';

export interface BannerProps {
  message: string;
  title?: string;
  tone?: Tone;
  icon?: ComponentProps<typeof Ionicons>['name'];
  testID?: string;
}

/** Inline notice ("Balans 10 ₼-dən az olduqda...", fee warning, dev OTP hint). */
export function Banner({ message, title, tone = 'warning', icon, testID = 'banner' }: BannerProps) {
  const t = TONES[tone];
  return (
    <View style={[styles.wrap, { backgroundColor: t.bg, borderColor: t.dot }]} testID={testID} accessibilityRole="alert">
      {icon ? <Ionicons name={icon} size={18} color={t.fg} style={styles.icon} /> : null}
      <View style={styles.text}>
        {title ? <AppText variant="bodyStrong" style={{ color: t.fg }}>{title}</AppText> : null}
        <AppText variant="small" style={{ color: t.fg }}>
          {message}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', borderRadius: radii.md, borderWidth: 1, padding: spacing.md, marginBottom: spacing.md },
  icon: { marginRight: spacing.sm, marginTop: 1 },
  text: { flex: 1 },
});
