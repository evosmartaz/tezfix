import React from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { BAKU_TZ, formatDate, formatTime } from '@tezfiks/shared';
import { AppText, colors, radii, spacing, useT } from '@tezfiks/mobile';
import { withBakuDate, withBakuTime } from '../lib/timing';

export interface ScheduledPickerProps {
  value: Date;
  minimumDate: Date;
  maximumDate: Date;
  onChange: (d: Date) => void;
  error?: string | null;
}

/** "Planla" date and time in Baku time (Asia/Baku), bounded by the public config's lead times. */
export function ScheduledPicker({ value, minimumDate, maximumDate, onChange, error }: ScheduledPickerProps) {
  const { t } = useT();

  const open = (mode: 'date' | 'time') => {
    DateTimePickerAndroid.open({
      value,
      mode,
      is24Hour: true,
      timeZoneName: BAKU_TZ,
      minimumDate: mode === 'date' ? minimumDate : undefined,
      maximumDate: mode === 'date' ? maximumDate : undefined,
      onChange: (e: DateTimePickerEvent, picked?: Date) => {
        if (e.type !== 'set' || !picked) return;
        onChange(mode === 'date' ? withBakuDate(value, picked) : withBakuTime(value, picked));
      },
    });
  };

  return (
    <View testID="scheduled-picker">
      {Platform.OS === 'android' ? (
        <View style={styles.row}>
          <Pressable style={styles.field} onPress={() => open('date')} accessibilityRole="button" testID="scheduled-date">
            <Ionicons name="calendar-outline" size={18} color={colors.primary} />
            <AppText variant="bodyStrong" style={styles.text}>
              {formatDate(value)}
            </AppText>
          </Pressable>
          <Pressable style={styles.field} onPress={() => open('time')} accessibilityRole="button" testID="scheduled-time">
            <Ionicons name="time-outline" size={18} color={colors.primary} />
            <AppText variant="bodyStrong" style={styles.text}>
              {formatTime(value)}
            </AppText>
          </Pressable>
        </View>
      ) : (
        <DateTimePicker
          value={value}
          mode="datetime"
          minimumDate={minimumDate}
          maximumDate={maximumDate}
          timeZoneName={BAKU_TZ}
          onChange={(_e: DateTimePickerEvent, d?: Date) => d && onChange(d)}
          testID="scheduled-native"
        />
      )}
      <AppText variant="caption" color={error ? 'danger' : 'textMuted'} style={styles.hint} testID="scheduled-hint">
        {error ?? t('request.scheduleHint')}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm },
  field: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    height: 48,
    paddingHorizontal: spacing.md,
  },
  text: { marginLeft: spacing.sm },
  hint: { marginTop: spacing.xs },
});
