import React, { useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { formatDateTime, formatRequestNumber, type ProjectSummary } from '@tezfiks/shared';
import { AppText, Button, Card, EmptyState, ErrorState, Header, LoadingState, Screen, Segmented, StatusPill, colors, spacing, useT } from '@tezfiks/mobile';
import { CategoryIcon } from '../components/CategoryIcon';
import { useProjectList, type RequestScope } from '../data/queries';
import { mergePages } from '../lib/orders';
import { formatDay, projectStatusTone } from '../lib/projects';

/** Biznes sifarişləri: the customer's B2B projects (active / history). */
export default function ProjectsRoute() {
  const { t } = useT();
  const [scope, setScope] = useState<RequestScope>('active');
  const list = useProjectList(scope);
  const items = mergePages(list.data?.pages);
  return (
    <Screen edges={['top', 'bottom']} testID="projects-screen" footer={<Button title={t('project.new')} onPress={() => router.push('/project/new' as never)} testID="projects-new" />}>
      <Header title={t('project.listTitle')} onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
      <Segmented
        options={[
          { value: 'active', label: t('orders.active') },
          { value: 'history', label: t('orders.history') },
        ]}
        value={scope}
        onChange={setScope}
        testID="projects-scope"
      />
      <View style={styles.gap} />
      {list.isPending ? (
        <LoadingState />
      ) : list.isError && !items.length ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(p) => p.id}
          renderItem={({ item }) => <ProjectCard p={item} />}
          onEndReached={() => {
            if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
          }}
          refreshControl={<RefreshControl refreshing={list.isRefetching && !list.isFetchingNextPage} onRefresh={() => void list.refetch()} tintColor={colors.primary} />}
          ListFooterComponent={list.isFetchingNextPage ? <ActivityIndicator color={colors.primary} /> : undefined}
          ListEmptyComponent={<EmptyState icon="briefcase-outline" title={t(scope === 'active' ? 'project.emptyActive' : 'project.emptyHistory')} testID="projects-empty" />}
          contentContainerStyle={styles.list}
        />
      )}
    </Screen>
  );
}

function ProjectCard({ p }: { p: ProjectSummary }) {
  const { t } = useT();
  return (
    <Card style={styles.card} onPress={() => router.push(`/project/${p.id}` as never)} testID={`project-card-${p.id}`}>
      <View style={styles.row}>
        <CategoryIcon icon={p.category.icon} size={18} />
        <View style={styles.text}>
          <AppText variant="bodyStrong">{p.title ?? p.category.name}</AppText>
          <AppText variant="caption" color="textMuted">
            {formatRequestNumber(p.number)} · {formatDay(p.dateFrom)} – {formatDay(p.dateTo)}
          </AppText>
        </View>
        <StatusPill label={t(`common:projectStatus.${p.status}`)} tone={projectStatusTone(p.status)} testID={`project-status-${p.id}`} />
      </View>
      <AppText variant="small" color="textMuted" numberOfLines={1}>
        {p.scope} · {t('common:units.workers', { count: p.workersNeeded })}
      </AppText>
      {p.status === 'OPEN' ? (
        <AppText variant="small" color="primaryDark" testID={`project-quotes-${p.id}`}>
          {t('project.quotesCount', { count: p.quotesCount })} · {t('project.deadline', { time: formatDateTime(p.quoteDeadline) })}
        </AppText>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  gap: { height: spacing.md },
  list: { paddingBottom: spacing.xl, flexGrow: 1 },
  card: { marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs },
  text: { flex: 1, marginHorizontal: spacing.md },
});
