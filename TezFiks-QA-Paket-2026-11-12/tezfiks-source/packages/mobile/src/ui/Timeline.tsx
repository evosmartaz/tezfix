import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, spacing } from '../theme/tokens';
import { AppText } from './Text';

export type TimelineStepState = 'done' | 'current' | 'pending';

export interface TimelineStep {
  key: string;
  label: string;
  /** "14:02" or null (renders "—"). */
  time?: string | null;
  state: TimelineStepState;
}

/** Vertical status list of board 03 "Aktiv sifariş" (Sifariş qəbul edildi 14:02 → Yola çıxdım → Ünvana çatdım → İş tamamlandı). */
export function Timeline({ steps, testID = 'timeline' }: { steps: TimelineStep[]; testID?: string }) {
  return (
    <View testID={testID}>
      {steps.map((step, i) => {
        const last = i === steps.length - 1;
        const dotColor = step.state === 'pending' ? colors.border : colors.primary;
        return (
          <View key={step.key} style={styles.row} testID={`${testID}-${step.key}`} accessibilityState={{ checked: step.state === 'done' }}>
            <View style={styles.rail}>
              <View style={[styles.dot, { backgroundColor: dotColor }, step.state === 'current' ? styles.current : null]} />
              {!last ? <View style={[styles.line, { backgroundColor: step.state === 'done' ? colors.primary : colors.border }]} /> : null}
            </View>
            <AppText variant={step.state === 'pending' ? 'body' : 'bodyStrong'} color={step.state === 'pending' ? 'textMuted' : 'text'} style={styles.label}>
              {step.label}
            </AppText>
            <AppText variant="small" color="textMuted">
              {step.time ?? '—'}
            </AppText>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', minHeight: 36 },
  rail: { width: 24, alignItems: 'center' },
  dot: { width: 14, height: 14, borderRadius: 7, marginTop: 3 },
  current: { borderWidth: 3, borderColor: colors.primarySoft, width: 18, height: 18, borderRadius: 9, marginTop: 1 },
  line: { width: 2, flex: 1, minHeight: 16, marginVertical: 2 },
  label: { flex: 1, marginLeft: spacing.sm },
});
