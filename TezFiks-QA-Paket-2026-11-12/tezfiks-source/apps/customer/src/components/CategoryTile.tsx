import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import type { Category } from '@tezfiks/shared';
import { AppText, colors, radii, shadows, spacing } from '@tezfiks/mobile';
import { CategoryIcon } from './CategoryIcon';

/** Home grid tile (board 02 B1: icon + service name). */
export function CategoryTile({ category, onPress, compact }: { category: Category; onPress: (c: Category) => void; compact?: boolean }) {
  return (
    <Pressable
      onPress={() => onPress(category)}
      accessibilityRole="button"
      accessibilityLabel={category.name}
      style={({ pressed }) => [styles.tile, compact && styles.compact, pressed && styles.pressed]}
      testID={`category-tile-${category.slug}`}
    >
      <CategoryIcon icon={category.icon} size={compact ? 18 : 22} />
      <AppText variant={compact ? 'small' : 'bodyStrong'} numberOfLines={2} style={[styles.label, compact && styles.labelCompact]}>
        {category.name}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    minHeight: 96,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    justifyContent: 'space-between',
    ...shadows.card,
  },
  compact: { minHeight: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start' },
  label: { marginTop: spacing.sm },
  labelCompact: { marginTop: 0, marginLeft: spacing.sm, flex: 1 },
  pressed: { opacity: 0.8 },
});
