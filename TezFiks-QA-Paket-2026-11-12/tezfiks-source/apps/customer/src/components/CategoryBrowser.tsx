import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { Category, Vertical } from '@tezfiks/shared';
import { AppText, EmptyState, Segmented, TextField, colors, spacing, useT } from '@tezfiks/mobile';
import { Ionicons } from '@expo/vector-icons';
import { buildCategoryTree, searchCategories } from '../lib/categories';
import { CategoryTile } from './CategoryTile';

export interface CategoryBrowserProps {
  categories: Category[];
  query: string;
  onQueryChange: (q: string) => void;
  vertical: Vertical;
  onVerticalChange: (v: Vertical) => void;
  onSelect: (c: Category) => void;
  autoFocus?: boolean;
  /** Highlighted services shown first (e.g. AI candidates). */
  suggestions?: Category[];
}

function pairs<T>(list: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += 2) out.push(list.slice(i, i + 2));
  return out;
}

/** "Bütün kateqoriyalar": vertical switch, folded search (tzFold) and services grouped by their group. */
export function CategoryBrowser({ categories, query, onQueryChange, vertical, onVerticalChange, onSelect, autoFocus, suggestions }: CategoryBrowserProps) {
  const { t } = useT();
  const searching = query.trim().length > 0;
  // Search covers both verticals: "akkumulyator" should find the auto service while the home vertical is selected.
  const results = useMemo(() => (searching ? searchCategories(categories, query) : []), [categories, query, searching]);
  const tree = useMemo(() => (searching ? [] : buildCategoryTree(categories, vertical)), [categories, vertical, searching]);

  const grid = (list: Category[], keyPrefix: string) =>
    pairs(list).map((row, i) => (
      <View key={`${keyPrefix}-${i}`} style={styles.row}>
        {row.map((c) => (
          <CategoryTile key={c.id} category={c} onPress={onSelect} compact />
        ))}
        {row.length === 1 ? <View style={styles.spacer} /> : null}
      </View>
    ));

  return (
    <View testID="category-browser">
      <TextField
        value={query}
        onChangeText={onQueryChange}
        placeholder={t('categories.searchPlaceholder')}
        autoFocus={autoFocus}
        left={<Ionicons name="search" size={18} color={colors.textMuted} />}
        returnKeyType="search"
        testID="category-search"
        accessibilityLabel={t('categories.searchPlaceholder')}
      />
      {!searching ? (
        <View style={styles.segment}>
          <Segmented
            options={[
              { value: 'HOME', label: t('common:vertical.HOME') },
              { value: 'AUTO', label: t('common:vertical.AUTO') },
            ]}
            value={vertical}
            onChange={onVerticalChange}
            testID="category-vertical"
          />
        </View>
      ) : null}
      {suggestions && suggestions.length ? (
        <View style={styles.section} testID="category-suggestions">
          <AppText variant="h3" style={styles.sectionTitle}>
            {t('categories.suggested')}
          </AppText>
          {grid(suggestions, 'sugg')}
        </View>
      ) : null}
      {searching ? (
        results.length ? (
          <View style={styles.section} testID="category-results">
            {grid(results, 'res')}
          </View>
        ) : (
          <EmptyState icon="search-outline" title={t('categories.noResults')} message={t('categories.noResultsHint')} testID="category-no-results" />
        )
      ) : (
        tree.map((node, gi) => (
          <View key={node.group?.id ?? `other-${gi}`} style={styles.section}>
            <AppText variant="h3" style={styles.sectionTitle}>
              {node.group?.name ?? t('categories.other')}
            </AppText>
            {grid(node.services, node.group?.id ?? `other-${gi}`)}
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  spacer: { flex: 1 },
  segment: { marginBottom: spacing.md },
  section: { marginBottom: spacing.md },
  sectionTitle: { marginBottom: spacing.sm },
});
