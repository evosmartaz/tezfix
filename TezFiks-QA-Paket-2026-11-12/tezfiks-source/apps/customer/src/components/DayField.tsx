import React from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { BAKU_TZ, bakuDayKey } from '@tezfiks/shared';
import { AppText, colors, radii, spacing } from '@tezfiks/mobile';
import { formatDay } from '../lib/projects';
import { fromBakuParts } from '../lib/timing';

/** Baku noon of a "YYYY-MM-DD" day (a safe Date for the native picker). */
export function dayToDate(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return fromBakuParts({ year: y, month: m, day: d, hour: 12, minute: 0 });
}

export interface DayFieldProps {
  label: string;
  value: string | null;
  placeholder: string;
  minimumDay: string;
  onChange: (day: string) => void;
  error?: string | null;
  testID: string;
}

/** A calendar day in Baku time ("15.10.2026"), picked with the native date dialog. */
export function DayField({ label, value, placeholder, minimumDay, onChange, error, testID }: DayFieldProps) {
  const current = value ? dayToDate(value) : dayToDate(minimumDay);
  const open = () => {
    DateTimePickerAndroid.open({
      value: current,
      mode: 'date',
      timeZoneName: BAKU_TZ,
      minimumDate: dayToDate(minimumDay),
      onChange: (e: DateTimePickerEvent, picked?: Date) => {
        if (e.type === 'set' && picked) onChange(bakuDayKey(picked));
      },
    });
  };
  return (
    <View style={styles.wrap}>
      <AppText variant="small" color="textMuted" style={styles.label}>
        {label}
      </AppText>
      {Platform.OS === 'android' ? (
        <Pressable onPress={open} style={[styles.field, error ? styles.invalid : null]} accessibilityRole="button" accessibilityLabel={label} testID={testID}>
          <Ionicons name="calendar-outline" size={18} color={colors.primary} />
          <AppText variant="body" color={value ? 'text' : 'textMuted'} style={styles.text} testID={`${testID}-value`}>
            {value ? formatDay(value) : placeholder}
          </AppText>
        </Pressable>
      ) : (
        <DateTimePicker value={current} mode="date" minimumDate={dayToDate(minimumDay)} timeZoneName={BAKU_TZ} onChange={(_e: DateTimePickerEvent, d?: Date) => d && onChange(bakuDayKey(d))} testID={testID} />
      )}
      {error ? (
        <AppText variant="caption" color="danger" testID={`${testID}-error`}>
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  label: { marginBottom: spacing.xs },
  field: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.surface, padding: spacing.md },
  invalid: { borderColor: colors.danger },
  text: { marginLeft: spacing.sm },
});
