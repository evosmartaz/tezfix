import React, { useState } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import type { Category, Vertical } from '@tezfiks/shared';
import { BottomSheet, useT } from '@tezfiks/mobile';
import { CategoryBrowser } from './CategoryBrowser';

export interface CategoryPickerSheetProps {
  visible: boolean;
  categories: Category[];
  initialVertical?: Vertical;
  suggestions?: Category[];
  onClose: () => void;
  onSelect: (c: Category) => void;
}

/** Category picker in a bottom sheet (change the service on the request form, or pick one after "Şəkil ilə tap"). */
export function CategoryPickerSheet({ visible, categories, initialVertical = 'HOME', suggestions, onClose, onSelect }: CategoryPickerSheetProps) {
  const { t } = useT();
  const { height } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const [vertical, setVertical] = useState<Vertical>(initialVertical);
  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('categories.pickTitle')} testID="category-picker">
      <ScrollView style={[styles.scroll, { maxHeight: height * 0.7 }]} keyboardShouldPersistTaps="handled">
        <CategoryBrowser
          categories={categories}
          query={query}
          onQueryChange={setQuery}
          vertical={vertical}
          onVerticalChange={setVertical}
          suggestions={suggestions}
          onSelect={(c) => {
            setQuery('');
            onSelect(c);
          }}
        />
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0 },
});
