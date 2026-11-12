import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppText, colors, radii, spacing } from '@tezfiks/mobile';

export interface StepperProps {
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
  label: string;
  decrementLabel: string;
  incrementLabel: string;
  testID?: string;
}

/** "− 3 usta +" (board 02 D, number of handymen). */
export function Stepper({ value, min, max, onChange, label, decrementLabel, incrementLabel, testID = 'stepper' }: StepperProps) {
  const canDec = value > min;
  const canInc = value < max;
  return (
    <View style={styles.wrap} testID={testID}>
      <Pressable
        onPress={() => canDec && onChange(value - 1)}
        disabled={!canDec}
        style={[styles.btn, !canDec && styles.disabled]}
        accessibilityRole="button"
        accessibilityLabel={decrementLabel}
        accessibilityState={{ disabled: !canDec }}
        testID={`${testID}-dec`}
      >
        <Ionicons name="remove" size={20} color={colors.text} />
      </Pressable>
      <AppText variant="h3" style={styles.value} testID={`${testID}-value`}>
        {label}
      </AppText>
      <Pressable
        onPress={() => canInc && onChange(value + 1)}
        disabled={!canInc}
        style={[styles.btn, styles.inc, !canInc && styles.disabled]}
        accessibilityRole="button"
        accessibilityLabel={incrementLabel}
        accessibilityState={{ disabled: !canInc }}
        testID={`${testID}-inc`}
      >
        <Ionicons name="add" size={20} color={colors.textInverse} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    padding: spacing.xs,
  },
  btn: { width: 40, height: 40, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  inc: { backgroundColor: colors.primary },
  disabled: { opacity: 0.4 },
  value: { flex: 1, textAlign: 'center' },
});
