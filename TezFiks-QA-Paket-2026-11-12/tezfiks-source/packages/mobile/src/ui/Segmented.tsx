import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors, radii, shadows, spacing } from '../theme/tokens';
import { AppText } from './Text';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /**
   * "pill" = Ev/Avto ustaları toggle. "green" (İndi/Planla/Təcili) is kept for existing callers; the v2 board draws both
   * as the same white-on-grey track.
   */
  variant?: 'pill' | 'green';
  testID?: string;
}

/** White selected segment on a grey track; every segment is at least 48 dp tall (UX-C09). */
export function Segmented<T extends string>({ options, value, onChange, testID = 'segmented' }: SegmentedProps<T>) {
  return (
    <View style={styles.track} testID={testID} accessibilityRole="tablist">
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            testID={`${testID}-${o.value}`}
            style={[styles.item, selected ? styles.selected : null]}
          >
            <AppText
              variant={selected ? 'bodyStrong' : 'body'}
              numberOfLines={1}
              style={{ color: selected ? colors.text : colors.textMuted }}
            >
              {o.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', backgroundColor: colors.border, borderRadius: radii.md + 2, padding: 4 },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 44, paddingHorizontal: spacing.xs, borderRadius: radii.md },
  selected: { backgroundColor: colors.surface, ...shadows.card },
});
