import React from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { api, formatDateTime, type NotificationView } from '@tezfiks/shared';
import { AppText, Button, EmptyState, ErrorState, Header, LoadingState, Screen, colors, radii, spacing, useApi, useT } from '@tezfiks/mobile';
import { qk, useNotifications } from '../data/queries';
import { notificationHref, notificationIcon } from '../lib/notifications';
import { mergePages } from '../lib/orders';

/** In-app notifications (newest first); a tap marks it read and opens what it is about. */
export default function NotificationsRoute() {
  const { t } = useT();
  const client = useApi();
  const queryClient = useQueryClient();
  const list = useNotifications();
  const items = mergePages(list.data?.pages);
  const anyUnread = items.some((n) => !n.readAt);

  const refreshAll = () => void queryClient.invalidateQueries({ queryKey: qk.notificationsRoot });

  const markAll = async () => {
    try {
      await client.call(api.notifications.markRead, { body: { all: true } });
    } catch {
      // the list stays as it was; the next refresh shows the truth
    }
    refreshAll();
  };

  const open = async (n: NotificationView) => {
    if (!n.readAt) {
      client
        .call(api.notifications.markRead, { body: { ids: [n.id] } })
        .then(refreshAll)
        .catch(() => undefined);
    }
    const href = notificationHref(n);
    if (href) router.push(href as never);
  };

  return (
    <Screen edges={['top', 'bottom']} testID="notifications-screen">
      <Header
        title={t('notifications.title')}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        right={anyUnread ? <Button variant="ghost" size="sm" fullWidth={false} title={t('notifications.markAll')} onPress={() => void markAll()} testID="notifications-mark-all" /> : undefined}
      />
      {list.isPending ? (
        <LoadingState testID="notifications-loading" />
      ) : list.isError && !items.length ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} testID="notifications-error" />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(n) => n.id}
          renderItem={({ item }) => <Row n={item} onPress={() => void open(item)} />}
          onEndReached={() => {
            if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
          }}
          onEndReachedThreshold={0.4}
          refreshControl={<RefreshControl refreshing={list.isRefetching && !list.isFetchingNextPage} onRefresh={() => void list.refetch()} tintColor={colors.primary} />}
          ListEmptyComponent={<EmptyState icon="notifications-off-outline" title={t('notifications.empty')} testID="notifications-empty" />}
          ListFooterComponent={list.isFetchingNextPage ? <ActivityIndicator color={colors.primary} style={styles.more} /> : undefined}
          contentContainerStyle={styles.list}
          testID="notifications-list"
        />
      )}
    </Screen>
  );
}

function Row({ n, onPress }: { n: NotificationView; onPress: () => void }) {
  const unread = !n.readAt;
  return (
    <Pressable onPress={onPress} style={[styles.row, unread ? styles.unread : null]} accessibilityRole="button" testID={`notification-${n.id}`}>
      <View style={styles.icon}>
        <Ionicons name={notificationIcon(n.type) as never} size={20} color={colors.primaryDark} />
      </View>
      <View style={styles.flex}>
        <AppText variant={unread ? 'bodyStrong' : 'body'}>{n.title}</AppText>
        <AppText variant="small" color="textMuted">
          {n.body}
        </AppText>
        <AppText variant="caption" color="textMuted">
          {formatDateTime(n.createdAt)}
        </AppText>
      </View>
      {unread ? <View style={styles.dot} testID={`notification-unread-${n.id}`} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { paddingBottom: spacing.xxl, flexGrow: 1 },
  more: { marginVertical: spacing.md },
  row: { flexDirection: 'row', alignItems: 'flex-start', padding: spacing.md, borderRadius: radii.md, marginBottom: spacing.sm, backgroundColor: colors.surface },
  unread: { backgroundColor: colors.primarySoft },
  icon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', marginRight: spacing.md },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary, marginTop: spacing.xs },
});
