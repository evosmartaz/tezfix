import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '../theme/tokens';
import { AppText } from './Text';

export interface StarsProps {
  /** 0..5; halves are shown for display values (4.5). */
  value: number;
  /** Makes the stars tappable (rating screens, board 02 C2). */
  onChange?: (value: number) => void;
  size?: number;
  /** Shows the numeric value after the stars ("4.9"). */
  showValue?: boolean;
  testID?: string;
}

export function starIcons(value: number): Array<'star' | 'star-half' | 'star-outline'> {
  const v = Math.max(0, Math.min(5, value));
  return Array.from({ length: 5 }, (_, i) => {
    if (v >= i + 1) return 'star';
    if (v >= i + 0.5) return 'star-half';
    return 'star-outline';
  });
}

export function Stars({ value, onChange, size = 20, showValue, testID = 'stars' }: StarsProps) {
  const icons = starIcons(value);
  return (
    <View style={styles.row} testID={testID} accessibilityRole={onChange ? 'adjustable' : 'text'} accessibilityValue={{ min: 0, max: 5, now: value }}>
      {icons.map((name, i) => {
        const star = <Ionicons name={name} size={size} color={name === 'star-outline' ? colors.borderStrong : colors.star} />;
        return onChange ? (
          <Pressable key={i} onPress={() => onChange(i + 1)} hitSlop={6} testID={`${testID}-${i + 1}`} style={styles.gap}>
            {star}
          </Pressable>
        ) : (
          <View key={i} style={styles.gapSmall}>
            {star}
          </View>
        );
      })}
      {showValue ? (
        <AppText variant="small" color="textMuted" style={styles.value}>
          {value.toFixed(1)}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  gap: { marginRight: spacing.sm },
  gapSmall: { marginRight: 2 },
  value: { marginLeft: spacing.xs },
});
