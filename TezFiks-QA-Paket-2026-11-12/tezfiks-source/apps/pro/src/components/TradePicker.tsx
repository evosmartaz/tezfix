import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { Category } from '@tezfiks/shared';
import { AppText, ErrorState, LoadingState, TextField, colors, radii, spacing, useT } from '@tezfiks/mobile';
import { groupTrades, toggleTrade } from '../lib/onboarding';
import { useCategories } from '../hooks/queries';

export interface TradePickerProps {
  value: string[];
  onChange: (ids: string[]) => void;
  max: number;
  error?: string | null;
  testID?: string;
}

/** Multi-select of active services grouped by category group, with Azerbaijani-folded search. */
export function TradePicker({ value, onChange, max, error, testID = 'trade-picker' }: TradePickerProps) {
  const { t } = useT();
  const categories = useCategories();
  const [query, setQuery] = useState('');
  const groups = useMemo(() => groupTrades((categories.data?.items ?? []) as Category[], query), [categories.data, query]);

  return (
    <View testID={testID}>
      <AppText variant="bodyStrong" style={styles.label}>
        {t('onboarding.trades')}
      </AppText>
      <AppText variant="small" color="textMuted" style={styles.hint}>
        {t('onboarding.tradesHint', { count: value.length, max })}
      </AppText>
      <TextField value={query} onChangeText={setQuery} placeholder={t('onboarding.tradesSearch')} testID={`${testID}-search`} />
      {categories.isLoading ? <LoadingState /> : null}
      {categories.isError ? <ErrorState error={categories.error} onRetry={() => void categories.refetch()} /> : null}
      {groups.map((g) => (
        <View key={g.id || 'other'} style={styles.group}>
          {g.name ? (
            <AppText variant="small" color="textMuted" style={styles.groupName}>
              {g.name}
            </AppText>
          ) : null}
          <View style={styles.chips}>
            {g.items.map((c) => {
              const on = value.includes(c.id);
              return (
                <Pressable
                  key={c.id}
                  onPress={() => onChange(toggleTrade(value, c.id, max))}
                  style={[styles.chip, on ? styles.chipOn : null]}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  testID={`trade-${c.id}`}
                >
                  <AppText variant="small" color={on ? 'textInverse' : 'text'}>
                    {c.name}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
      {error ? (
        <AppText variant="small" color="danger" testID={`${testID}-error`}>
          {t(error)}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { marginBottom: spacing.xxs },
  hint: { marginBottom: spacing.sm },
  group: { marginTop: spacing.sm },
  groupName: { marginBottom: spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginRight: spacing.sm,
    marginBottom: spacing.sm,
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
});
