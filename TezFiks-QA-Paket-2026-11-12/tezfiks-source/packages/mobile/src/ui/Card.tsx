import React, { type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radii, shadows, spacing } from '../theme/tokens';

export interface CardProps {
  children: ReactNode;
  onPress?: () => void;
  /** Dark card (board 03 "Cari balans", board 02 guarantee explainer). */
  dark?: boolean;
  /** Highlighted with the Figma v2 primary-blue border (selected option). */
  selected?: boolean;
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  accessibilityLabel?: string;
}

export function Card({ children, onPress, dark, selected, padded = true, style, testID, accessibilityLabel }: CardProps) {
  const content = [
    styles.card,
    dark ? styles.dark : styles.light,
    selected ? styles.selected : null,
    padded ? styles.padded : null,
    style,
  ];
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [content, pressed ? styles.pressed : null]}
        accessibilityRole="button"
        accessibilityState={{ selected: !!selected }}
        accessibilityLabel={accessibilityLabel}
        testID={testID}
      >
        {children}
      </Pressable>
    );
  }
  return (
    <View style={content} testID={testID} accessibilityLabel={accessibilityLabel}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radii.lg, borderWidth: 1, overflow: 'hidden' },
  light: { backgroundColor: colors.surface, borderColor: colors.border, ...shadows.card },
  dark: { backgroundColor: colors.dark, borderColor: colors.dark },
  selected: { borderColor: colors.primary, borderWidth: 2 },
  padded: { padding: spacing.lg },
  pressed: { opacity: 0.85 },
});
