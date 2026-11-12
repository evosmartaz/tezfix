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
  /** "pill" = Ev/Avto ustaları toggle; "green" = İndi/Planla/Təcili. */
  variant?: 'pill' | 'green';
  testID?: string;
}

export function Segmented<T extends string>({ options, value, onChange, variant = 'pill', testID = 'segmented' }: SegmentedProps<T>) {
  return (
    <View style={[styles.track, variant === 'green' ? styles.trackGreen : null]} testID={testID} accessibilityRole="tablist">
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            testID={`${testID}-${o.value}`}
            style={[
              styles.item,
              selected && variant === 'pill' ? styles.selectedPill : null,
              selected && variant === 'green' ? styles.selectedGreen : null,
            ]}
          >
            <AppText
              variant="small"
              style={{ fontFamily: 'Inter_600SemiBold', color: selected && variant === 'green' ? colors.textInverse : selected ? colors.text : colors.textMuted }}
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
  track: { flexDirection: 'row', backgroundColor: '#EEF1F4', borderRadius: radii.pill, padding: 3 },
  trackGreen: { backgroundColor: 'transparent', gap: spacing.sm, padding: 0 },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.sm, borderRadius: radii.pill },
  selectedPill: { backgroundColor: colors.surface, ...shadows.card },
  selectedGreen: { backgroundColor: colors.primary },
});
