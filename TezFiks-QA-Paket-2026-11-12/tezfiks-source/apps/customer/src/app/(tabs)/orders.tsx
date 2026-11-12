import React, { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button, EmptyState, ErrorState, Header, LoadingState, Screen, Segmented, colors, spacing, useT } from '@tezfiks/mobile';
import { RequestCard } from '../../components/RequestCard';
import { useRequestList, type RequestScope } from '../../data/queries';
import { mergePages, requestHref } from '../../lib/orders';

/** Sifarişlər: active and history lists (cursor pages), pull to refresh, tap → searching screen or request detail. */
export default function CustomerOrders() {
  const { t } = useT();
  const [scope, setScope] = useState<RequestScope>('active');
  const list = useRequestList(scope);
  const items = mergePages(list.data?.pages);

  return (
    <Screen edges={['top']} testID="orders-screen">
      <Header
        title={t('tabs.orders')}
        right={
          <Pressable onPress={() => router.push('/projects' as never)} hitSlop={8} style={styles.business} accessibilityRole="link" accessibilityLabel={t('profile.projects')} testID="orders-business">
            <Ionicons name="briefcase-outline" size={18} color={colors.primaryDark} />
          </Pressable>
        }
      />
      <Segmented
        options={[
          { value: 'active', label: t('orders.active') },
          { value: 'history', label: t('orders.history') },
        ]}
        value={scope}
        onChange={setScope}
        testID="orders-scope"
      />
      <View style={styles.gap} />
      {list.isPending ? (
        <LoadingState testID="orders-loading" />
      ) : list.isError && !items.length ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} testID="orders-error" />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(r) => r.id}
          renderItem={({ item }) => <RequestCard request={item} onPress={(r) => router.push(requestHref(r) as never)} />}
          onEndReached={() => {
            if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
          }}
          onEndReachedThreshold={0.4}
          refreshControl={<RefreshControl refreshing={list.isRefetching && !list.isFetchingNextPage} onRefresh={() => void list.refetch()} tintColor={colors.primary} />}
          ListFooterComponent={list.isFetchingNextPage ? <ActivityIndicator color={colors.primary} style={styles.more} /> : undefined}
          ListEmptyComponent={
            <EmptyState
              icon="receipt-outline"
              title={t(scope === 'active' ? 'orders.emptyActive' : 'orders.emptyHistory')}
              message={t('orders.emptyHint')}
              action={<Button title={t('request.submit')} onPress={() => router.push('/')} fullWidth={false} testID="orders-new" />}
              testID="orders-empty"
            />
          }
          contentContainerStyle={styles.list}
          testID="orders-list"
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  gap: { height: spacing.md },
  business: { padding: spacing.xs },
  list: { paddingBottom: spacing.xxl, flexGrow: 1 },
  more: { marginVertical: spacing.md },
});
