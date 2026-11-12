import React from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { formatDateTime, formatMoney, type ProAssignment } from '@tezfiks/shared';
import { AppText, Button, Card, EmptyState, ErrorState, LoadingState, errorMessage, spacing, useT } from '@tezfiks/mobile';
import { mergeJobPages, proRole, redactForRole, type JobRole } from '../lib/jobs';
import { useJobPages, type JobScope } from '../hooks/queries';
import { JobStatusBadge } from './JobParts';

export type { JobScope };

/** Personal jobs (GET /pro/assignments) or company jobs (GET /company/:id/assignments), paginated. */
export function JobList({ scope, companyId }: { scope: JobScope; companyId: string | null }) {
  const { t } = useT();
  const q = useJobPages(scope, companyId);
  if (q.isLoading) return <LoadingState />;
  if (q.isError) return <ErrorState error={q.error} message={errorMessage(t, q.error)} onRetry={() => void q.refetch()} />;
  const items = mergeJobPages(q.data?.pages ?? []);
  if (!items.length) return <EmptyState icon="receipt-outline" title={scope === 'active' ? t('orders.empty') : t('orders.emptyHistory')} testID={`orders-empty-${scope}`} />;
  return (
    <View testID={`orders-list-${scope}`}>
      {items.map((a) => (
        <JobRow key={a.id} job={a} role={companyId ? 'manager' : proRole(a)} companyId={companyId} />
      ))}
      {q.hasNextPage ? (
        <Button variant="ghost" title={t('orders.loadMore')} loading={q.isFetchingNextPage} onPress={() => void q.fetchNextPage()} testID="orders-more" />
      ) : null}
    </View>
  );
}

function JobRow({ job: raw, role, companyId }: { job: ProAssignment; role: JobRole; companyId: string | null }) {
  const { t, locale } = useT();
  const job = redactForRole(raw, role);
  const when = job.completedAt ?? job.cancelledAt ?? job.scheduledAt ?? job.acceptedAt;
  return (
    <Card
      style={styles.card}
      onPress={() => router.push((companyId ? `/company/${companyId}/jobs/${job.id}` : `/job/${job.id}`) as never)}
      testID={`order-${job.id}`}
    >
      <View style={styles.row}>
        <AppText variant="bodyStrong" style={styles.flex} numberOfLines={1}>
          {`#${job.requestNumber} · ${job.category.name}`}
        </AppText>
        <JobStatusBadge job={job} testID={`order-status-${job.id}`} />
      </View>
      <AppText variant="small" color="textMuted" style={styles.line} numberOfLines={1}>
        {job.address.formatted}
      </AppText>
      <View style={[styles.row, styles.line]}>
        <AppText variant="caption" color="textMuted" style={styles.flex}>
          {when ? formatDateTime(when) : ''}
          {role === 'manager' ? ` · ${t('orders.workerLine', { name: `${job.worker.firstName} ${job.worker.lastName}` })}` : ''}
        </AppText>
        {job.price ? (
          <AppText variant="bodyStrong" color="primary" testID={`order-price-${job.id}`}>
            {formatMoney(job.price.total, locale)}
          </AppText>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1, marginRight: spacing.sm },
  line: { marginTop: spacing.xs },
});
