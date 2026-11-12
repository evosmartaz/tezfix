import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Slider from '@react-native-community/slider';
import { Ionicons } from '@expo/vector-icons';
import { AppText, colors, spacing, useT } from '@tezfiks/mobile';
import { clampRadius } from '../lib/onboarding';

export interface RadiusSliderProps {
  value: number;
  onChange: (km: number) => void;
  min: number;
  max: number;
  error?: string | null;
  testID?: string;
}

/** Service radius slider (2–25 km for solo handymen) with −/+ buttons for precise steps. */
export function RadiusSlider({ value, onChange, min, max, error, testID = 'radius' }: RadiusSliderProps) {
  const { t } = useT();
  const set = (v: number) => onChange(clampRadius(v, { min, max }));
  return (
    <View style={styles.wrap} testID={testID}>
      <View style={styles.head}>
        <AppText variant="bodyStrong">{t('onboarding.radius')}</AppText>
        <AppText variant="bodyStrong" color="primary" testID={`${testID}-value`}>
          {t('onboarding.radiusValue', { km: value })}
        </AppText>
      </View>
      <View style={styles.row}>
        <Pressable onPress={() => set(value - 1)} hitSlop={8} accessibilityRole="button" accessibilityLabel="-" testID={`${testID}-minus`}>
          <Ionicons name="remove-circle-outline" size={28} color={colors.primary} />
        </Pressable>
        <Slider
          style={styles.slider}
          minimumValue={min}
          maximumValue={max}
          step={1}
          value={value}
          onValueChange={(v: number) => set(v)}
          minimumTrackTintColor={colors.primary}
          maximumTrackTintColor={colors.border}
          thumbTintColor={colors.primary}
          testID={`${testID}-slider`}
        />
        <Pressable onPress={() => set(value + 1)} hitSlop={8} accessibilityRole="button" accessibilityLabel="+" testID={`${testID}-plus`}>
          <Ionicons name="add-circle-outline" size={28} color={colors.primary} />
        </Pressable>
      </View>
      <AppText variant="caption" color="textMuted">
        {t('onboarding.radiusHint', { min, max })}
      </AppText>
      {error ? (
        <AppText variant="small" color="danger">
          {t(error)}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginVertical: spacing.md },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', marginVertical: spacing.xs },
  slider: { flex: 1, height: 40, marginHorizontal: spacing.sm },
});
