import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { api, formatDate, formatDateTime, type ProviderProjectView } from '@tezfiks/shared';
import { AppText, Badge, Card, EmptyState, ErrorState, Header, LoadingState, Screen, Segmented, errorMessage, spacing, useApi, useT } from '@tezfiks/mobile';
import { qk } from '../../hooks/queries';
import { projectStatusTone } from '../../lib/projects';

type Tab = 'open' | 'mine';

/** Projects (B2B, spec 4.10): open requests to quote on and the provider's own quotes / awarded projects. */
export default function Projects() {
  const { t } = useT();
  const client = useApi();
  const params = useLocalSearchParams<{ companyId?: string; tab?: string }>();
  const companyId = typeof params.companyId === 'string' && params.companyId ? params.companyId : null;
  const [tab, setTab] = useState<Tab>(params.tab === 'mine' ? 'mine' : 'open');
  const query = companyId ? { companyId } : {};
  const open = useQuery({
    queryKey: qk.projectsOpen(companyId),
    enabled: tab === 'open',
    queryFn: () => client.call(api.providerProjects.open, { query }),
  });
  const mine = useQuery({
    queryKey: qk.projectsMine(companyId),
    enabled: tab === 'mine',
    queryFn: () => client.call(api.providerProjects.mine, { query }),
  });
  const q = tab === 'open' ? open : mine;
  return (
    <Screen scroll testID="projects-screen" onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      <Header title={t('projects.title')} subtitle={t('projects.subtitle')} onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
      <View style={styles.block}>
        <Segmented<Tab>
          options={[
            { value: 'open', label: t('projects.tabOpen') },
            { value: 'mine', label: t('projects.tabMine') },
          ]}
          value={tab}
          onChange={setTab}
          testID="projects-tab"
        />
      </View>
      {q.isLoading ? <LoadingState /> : null}
      {q.isError ? <ErrorState error={q.error} message={errorMessage(t, q.error)} onRetry={() => void q.refetch()} /> : null}
      {q.data && !q.data.items.length ? (
        <EmptyState icon="business-outline" title={tab === 'open' ? t('projects.empty') : t('projects.emptyMine')} testID={`projects-empty-${tab}`} />
      ) : null}
      {q.data?.items.map((p) => <ProjectCard key={p.id} p={p} companyId={companyId} />)}
    </Screen>
  );
}

function ProjectCard({ p, companyId }: { p: ProviderProjectView; companyId: string | null }) {
  const { t } = useT();
  return (
    <Card
      style={styles.card}
      onPress={() => router.push((companyId ? `/projects/${p.id}?companyId=${companyId}` : `/projects/${p.id}`) as never)}
      testID={`project-${p.id}`}
    >
      <View style={styles.row}>
        <AppText variant="bodyStrong" style={styles.flex} numberOfLines={1}>
          {p.title ?? p.category.name}
        </AppText>
        <Badge label={t(`common:projectStatus.${p.status}`)} tone={projectStatusTone(p.status)} />
      </View>
      <AppText variant="small" color="textMuted">
        {`${t('projects.number', { number: p.number })} · ${p.category.name}`}
      </AppText>
      <AppText variant="small" style={styles.line}>
        {p.scope}
      </AppText>
      <AppText variant="small" color="textMuted">
        {`${t('projects.dates', { from: formatDate(`${p.dateFrom}T12:00:00Z`), to: formatDate(`${p.dateTo}T12:00:00Z`) })} · ${t('projects.workers', { count: p.workersNeeded })}`}
      </AppText>
      <AppText variant="small" color="textMuted">
        {p.addressText}
      </AppText>
      {p.status === 'OPEN' ? (
        <AppText variant="caption" color="primary" style={styles.line}>
          {t('projects.deadline', { time: formatDateTime(p.quoteDeadline) })}
        </AppText>
      ) : null}
      {p.myQuote ? (
        <AppText variant="caption" color="textMuted" testID={`project-myquote-${p.id}`}>
          {`${t('projects.myQuote')}: ${t(`common:quoteStatus.${p.myQuote.status}`)}`}
        </AppText>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  block: { marginBottom: spacing.md },
  card: { marginBottom: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1, marginRight: spacing.sm },
  line: { marginTop: spacing.xs },
});
