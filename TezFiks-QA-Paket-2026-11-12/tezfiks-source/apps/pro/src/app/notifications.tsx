import React from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { api, formatDateTime } from '@tezfiks/shared';
import { AppText, Button, Card, EmptyState, ErrorState, Header, LoadingState, Screen, colors, errorMessage, radii, spacing, useApi, useT } from '@tezfiks/mobile';
import { qk } from '../hooks/queries';
import { notificationHref } from '../lib/notifications';

export default function Notifications() {
  const { t } = useT();
  const client = useApi();
  const queryClient = useQueryClient();
  const q = useInfiniteQuery({
    queryKey: qk.notifications,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => client.call(api.notifications.list, { query: { limit: 30, ...(pageParam ? { cursor: pageParam } : {}) } }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = (q.data?.pages ?? []).flatMap((p) => p.items);
  const unread = items.filter((n) => !n.readAt).map((n) => n.id);

  const markRead = async (body: { ids?: string[]; all?: boolean }) => {
    await client.call(api.notifications.markRead, { body }).catch(() => undefined);
    void queryClient.invalidateQueries({ queryKey: qk.notifications });
  };

  return (
    <Screen scroll testID="notifications-screen" onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      <Header
        title={t('notificationsList.title')}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        right={
          unread.length ? <Button variant="ghost" size="sm" fullWidth={false} title={t('notificationsList.markAll')} onPress={() => void markRead({ all: true })} testID="notifications-read-all" /> : undefined
        }
      />
      {q.isLoading ? <LoadingState /> : null}
      {q.isError ? <ErrorState error={q.error} message={errorMessage(t, q.error)} onRetry={() => void q.refetch()} /> : null}
      {q.data && !items.length ? <EmptyState icon="notifications-outline" title={t('notificationsList.empty')} testID="notifications-empty" /> : null}
      {items.map((n) => (
        <Card
          key={n.id}
          style={[styles.card, n.readAt ? null : styles.unread]}
          onPress={() => {
            if (!n.readAt) void markRead({ ids: [n.id] });
            const href = notificationHref(n);
            if (href) router.push(href as never);
          }}
          testID={`notification-${n.id}`}
        >
          <View style={styles.row}>
            {n.readAt ? null : <View style={styles.dot} />}
            <AppText variant="bodyStrong" style={styles.flex}>
              {n.title}
            </AppText>
          </View>
          <AppText variant="small">{n.body}</AppText>
          <AppText variant="caption" color="textMuted" style={styles.line}>
            {formatDateTime(n.createdAt)}
          </AppText>
        </Card>
      ))}
      {q.hasNextPage ? <Button variant="ghost" title={t('orders.loadMore')} onPress={() => void q.fetchNextPage()} loading={q.isFetchingNextPage} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.sm },
  unread: { borderColor: colors.primary },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  dot: { width: 8, height: 8, borderRadius: radii.pill, backgroundColor: colors.primary, marginRight: spacing.sm },
  line: { marginTop: spacing.xs },
});
