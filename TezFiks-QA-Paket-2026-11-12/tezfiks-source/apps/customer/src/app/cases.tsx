import React from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { formatDateTime, formatRequestNumber, type CaseView } from '@tezfiks/shared';
import { AppText, Card, EmptyState, ErrorState, Header, LoadingState, Screen, StatusPill, spacing, useT } from '@tezfiks/mobile';
import { useCases } from '../data/queries';
import { mergePages } from '../lib/orders';

function caseTone(status: CaseView['status']): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  if (status === 'RESOLVED' || status === 'REDISPATCHED') return 'success';
  if (status === 'REJECTED') return 'danger';
  if (status === 'IN_REVIEW') return 'info';
  return 'warning';
}

/** Müraciətlərim: guarantee claims and price disputes the customer opened, with the admin's decision. */
export default function CasesRoute() {
  const { t } = useT();
  const list = useCases();
  const items = mergePages(list.data?.pages);
  return (
    <Screen edges={['top', 'bottom']} testID="cases-screen">
      <Header title={t('cases.title')} onBack={() => (router.canGoBack() ? router.back() : router.replace('/profile'))} />
      {list.isPending ? (
        <LoadingState />
      ) : list.isError && !items.length ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(c) => c.id}
          onEndReached={() => {
            if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
          }}
          renderItem={({ item: c }) => (
            <Card
              style={styles.card}
              testID={`case-${c.id}`}
              onPress={
                c.followUpRequestId
                  ? () => router.push(`/request/${c.followUpRequestId}` as never)
                  : c.assignmentId
                    ? () => router.push(`/assignment/${c.assignmentId}` as never)
                    : c.projectId
                      ? () => router.push(`/project/${c.projectId}` as never)
                      : undefined
              }
            >
              <View style={styles.row}>
                <AppText variant="bodyStrong" style={styles.flex}>
                  {t(`common:caseType.${c.type}`)}
                  {c.requestNumber ? ` · ${t('wallet.request', { number: formatRequestNumber(c.requestNumber) })}` : ''}
                  {c.projectNumber ? ` · ${t('wallet.project', { number: formatRequestNumber(c.projectNumber) })}` : ''}
                </AppText>
                <StatusPill label={t(`common:caseStatus.${c.status}`)} tone={caseTone(c.status)} testID={`case-status-${c.id}`} />
              </View>
              <AppText variant="small" color="textMuted" numberOfLines={3}>
                {c.description}
              </AppText>
              {c.resolutionNote ? (
                <AppText variant="small" style={styles.note}>
                  {t('cases.resolution', { note: c.resolutionNote })}
                </AppText>
              ) : null}
              <AppText variant="caption" color="textMuted">
                {formatDateTime(c.createdAt)}
              </AppText>
            </Card>
          )}
          ListEmptyComponent={<EmptyState icon="shield-checkmark-outline" title={t('cases.empty')} testID="cases-empty" />}
          contentContainerStyle={styles.list}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { paddingBottom: spacing.xl, flexGrow: 1 },
  card: { marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs },
  note: { marginTop: spacing.xs },
});
