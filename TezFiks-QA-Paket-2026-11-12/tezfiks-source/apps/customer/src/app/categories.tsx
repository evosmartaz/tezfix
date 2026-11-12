import React, { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import type { Category, Vertical } from '@tezfiks/shared';
import { ErrorState, Header, LoadingState, Screen, useT } from '@tezfiks/mobile';
import { CategoryBrowser } from '../components/CategoryBrowser';
import { useCategories } from '../data/queries';
import { categoryFormHref } from '../lib/categories';

/** Board 02 "Bütün kateqoriyalar": grouped services per vertical, folded search; a tap opens the request form. */
export default function CategoriesRoute() {
  const { t } = useT();
  const params = useLocalSearchParams<{ vertical?: string; focus?: string; q?: string }>();
  const [vertical, setVertical] = useState<Vertical>(params.vertical === 'AUTO' ? 'AUTO' : 'HOME');
  const [query, setQuery] = useState(typeof params.q === 'string' ? params.q : '');
  const categories = useCategories();

  const select = (c: Category) => router.push(categoryFormHref(c));

  return (
    <Screen scroll edges={['top']} testID="categories-screen">
      <Header title={t('categories.title')} onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
      {categories.isPending ? (
        <LoadingState />
      ) : categories.isError ? (
        <ErrorState error={categories.error} onRetry={() => void categories.refetch()} />
      ) : (
        <CategoryBrowser
          categories={categories.data}
          query={query}
          onQueryChange={setQuery}
          vertical={vertical}
          onVerticalChange={setVertical}
          onSelect={select}
          autoFocus={params.focus === '1'}
        />
      )}
    </Screen>
  );
}
