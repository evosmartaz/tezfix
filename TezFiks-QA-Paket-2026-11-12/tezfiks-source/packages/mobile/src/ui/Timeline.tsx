import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radii, spacing } from '../theme/tokens';
import { AppText } from './Text';

export type TimelineStepState = 'done' | 'current' | 'pending';

export interface TimelineStep {
  key: string;
  label: string;
  /** "14:02" or null (renders "—"). */
  time?: string | null;
  state: TimelineStepState;
}

/**
 * Vertical status list (Sifariş qəbul edildi 14:02 → Usta yola çıxdı → Usta ünvana çatdı → İş tamamlandı).
 * Done steps get a filled check, the current step an outlined ring with its time in a blue pill, pending steps an
 * empty circle and muted text (UX-C06, UX-P13).
 */
export function Timeline({ steps, testID = 'timeline' }: { steps: TimelineStep[]; testID?: string }) {
  return (
    <View testID={testID}>
      {steps.map((step) => {
        const pending = step.state === 'pending';
        return (
          <View key={step.key} style={styles.row} testID={`${testID}-${step.key}`} accessibilityState={{ checked: step.state === 'done' }}>
            {step.state === 'done' ? (
              <View style={[styles.marker, styles.done]}>
                <Ionicons name="checkmark" size={15} color={colors.textInverse} />
              </View>
            ) : step.state === 'current' ? (
              <View style={styles.halo}>
                <View style={[styles.marker, styles.current]}>
                  <View style={styles.currentDot} />
                </View>
              </View>
            ) : (
              <View style={[styles.marker, styles.pending]} />
            )}
            <AppText variant={pending ? 'body' : 'bodyStrong'} color={pending ? 'textMuted' : 'text'} style={styles.label}>
              {step.label}
            </AppText>
            {step.state === 'current' && step.time ? (
              <View style={styles.nowPill}>
                <AppText variant="caption" color="primary">
                  {step.time}
                </AppText>
              </View>
            ) : (
              <AppText variant="small" color="textMuted">
                {step.time ?? '—'}
              </AppText>
            )}
          </View>
        );
      })}
    </View>
  );
}

const MARKER = 22;

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  marker: { width: MARKER, height: MARKER, borderRadius: MARKER / 2, alignItems: 'center', justifyContent: 'center' },
  done: { backgroundColor: colors.primary },
  halo: { width: MARKER + 6, height: MARKER + 6, borderRadius: (MARKER + 6) / 2, marginHorizontal: -3, backgroundColor: colors.primaryHalo, alignItems: 'center', justifyContent: 'center' },
  current: { backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.primary },
  currentDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  pending: { borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  label: { flex: 1, marginLeft: spacing.md },
  nowPill: { backgroundColor: colors.primarySoft, borderRadius: radii.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 },
});
