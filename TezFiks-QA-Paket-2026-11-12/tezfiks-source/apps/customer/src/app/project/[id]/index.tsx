import React, { useState } from 'react';
import { Image, ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { api, formatDate, formatDateTime, formatMoney, formatRequestNumber, type ProjectDetail, type QuoteView } from '@tezfiks/shared';
import {
  AppText,
  Avatar,
  Badge,
  Button,
  Card,
  ErrorState,
  Header,
  LoadingState,
  Screen,
  Segmented,
  StatusPill,
  Stars,
  colors,
  radii,
  spacing,
  useApi,
  useClockOffset,
  useSocketEvent,
  useT,
  useToast,
} from '@tezfiks/mobile';
import { ConfirmSheet } from '../../../components/ConfirmSheet';
import { qk, useProject } from '../../../data/queries';
import { useKeyRegistry } from '../../../hooks/useAssignmentLive';
import { addressDetails } from '../../../lib/address';
import {
  canAcceptQuote,
  cheapestQuoteId,
  formatDay,
  latestProgress,
  projectGuaranteeOpen,
  projectStatusTone,
  quotePerWorkerDay,
  sortQuotes,
  type QuoteSort,
} from '../../../lib/projects';
import { requestErrorInfo } from '../../../lib/requestErrors';

const RATEABLE = ['COMPLETED', 'INVOICED', 'PAID'];

/** B2B project: details, quotes comparison and accept ("Müqayisə və təsdiq"), daily reports, invoice, rating, guarantee. */
export default function ProjectDetailRoute() {
  const { t, locale } = useT();
  const client = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const keys = useKeyRegistry();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useProject(id);
  const [sort, setSort] = useState<QuoteSort>('price');
  const [accepting, setAccepting] = useState<QuoteView | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const clockOffset = useClockOffset();

  // Quotes, reports and invoices arrive as notifications about this project.
  useSocketEvent('notification:new', (n) => {
    if (n.data.projectId === id) void q.refetch();
  });

  const back = () => (router.canGoBack() ? router.back() : router.replace('/projects' as never));

  if (q.isPending) return <LoadingState testID="project-loading" />;
  if (q.isError || !q.data) {
    return (
      <Screen testID="project-screen">
        <Header onBack={back} />
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </Screen>
    );
  }
  const p = q.data;

  const store = (updated: ProjectDetail) => {
    queryClient.setQueryData(qk.project(updated.id), updated);
    void queryClient.invalidateQueries({ queryKey: qk.projectsRoot });
  };

  const accept = async () => {
    if (!accepting) return;
    setBusy(true);
    const action = `accept-${accepting.id}`;
    try {
      const updated = await client.call(api.projects.acceptQuote, { params: { id: p.id, quoteId: accepting.id }, idempotencyKey: keys.get(action) });
      keys.settle(action);
      store(updated);
      setAccepting(null);
      toast.show(t('project.accepted'), { kind: 'success' });
    } catch (err) {
      keys.settle(action, err);
      toast.show(t(requestErrorInfo(err).messageKey), { kind: 'error' });
      void q.refetch();
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    try {
      store(await client.call(api.projects.cancel, { params: { id: p.id } }));
      setCancelOpen(false);
      toast.show(t('project.cancelled'), { kind: 'success' });
    } catch (err) {
      toast.show(t(requestErrorInfo(err).messageKey), { kind: 'error' });
      void q.refetch();
    } finally {
      setBusy(false);
    }
  };

  const cheapest = cheapestQuoteId(p.quotes);
  const quotes = sortQuotes(p.quotes, sort);
  const details = addressDetails(p.address, t);
  const guaranteeOpen = projectGuaranteeOpen(p, clockOffset);

  return (
    <Screen scroll edges={['top', 'bottom']} refreshing={q.isRefetching} onRefresh={() => void q.refetch()} testID="project-screen">
      <Header
        onBack={back}
        title={`${t('project.newTitle')} ${formatRequestNumber(p.number)}`}
        right={<StatusPill label={t(`common:projectStatus.${p.status}`)} tone={projectStatusTone(p.status)} testID="project-status" />}
      />

      <Card style={styles.block} testID="project-info">
        <AppText variant="h3">{p.title ?? p.category.name}</AppText>
        {p.title ? (
          <AppText variant="small" color="textMuted">
            {p.category.name}
          </AppText>
        ) : null}
        <Line label={t('project.scope')} value={p.scope} />
        <Line label={t('project.dates')} value={`${formatDay(p.dateFrom)} – ${formatDay(p.dateTo)}`} />
        <Line label={t('project.workers')} value={t('common:units.workers', { count: p.workersNeeded })} />
        <Line label={t('project.site')} value={[p.address.formatted, details].filter(Boolean).join(' · ')} />
        <AppText variant="body" style={styles.desc}>
          {p.description}
        </AppText>
        {p.photos.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photos}>
            {p.photos.map((f) => (
              <Image key={f.id} source={{ uri: f.url }} style={styles.photo} />
            ))}
          </ScrollView>
        ) : null}
        {p.status === 'OPEN' ? (
          <AppText variant="small" color="primaryDark" style={styles.desc} testID="project-deadline">
            {t('project.deadline', { time: formatDateTime(p.quoteDeadline) })}
          </AppText>
        ) : null}
      </Card>

      {p.awardedQuote ? (
        <>
          <AppText variant="h3" style={styles.title}>
            {t('project.awarded')}
          </AppText>
          <QuoteCard quote={p.awardedQuote} testID="project-awarded" />
        </>
      ) : null}

      {p.status === 'OPEN' || (!p.awardedQuote && p.quotes.length) ? (
        <>
          <AppText variant="h3" style={styles.title}>
            {t('project.quotesTitle')}
          </AppText>
          {p.quotes.length > 1 ? (
            <Segmented
              options={[
                { value: 'price', label: t('project.sortPrice') },
                { value: 'rating', label: t('project.sortRating') },
              ]}
              value={sort}
              onChange={setSort}
              testID="project-sort"
            />
          ) : null}
          <View style={styles.gap} />
          {quotes.length ? (
            quotes.map((qv) => (
              <QuoteCard
                key={qv.id}
                quote={qv}
                cheapest={qv.id === cheapest && p.quotes.length > 1}
                onAccept={canAcceptQuote(p, qv) ? () => setAccepting(qv) : undefined}
                testID={`project-quote-${qv.id}`}
              />
            ))
          ) : (
            <AppText variant="small" color="textMuted" testID="project-no-quotes">
              {t('project.noQuotes')}
            </AppText>
          )}
        </>
      ) : null}

      {p.awardedQuote ? (
        <>
          <View style={styles.reportHead}>
            <AppText variant="h3" style={styles.title}>
              {t('project.reports')}
            </AppText>
            <AppText variant="bodyStrong" color="primaryDark" testID="project-progress">
              {t('project.progress', { percent: latestProgress(p) })}
            </AppText>
          </View>
          {p.reports.length ? (
            p.reports.map((r) => (
              <Card key={r.id} style={styles.block} testID={`project-report-${r.id}`}>
                <View style={styles.reportHead}>
                  <AppText variant="bodyStrong">{formatDay(r.reportDate)}</AppText>
                  <Badge label={`${r.progressPercent}%`} tone="info" />
                </View>
                <AppText variant="body">{r.note}</AppText>
                <AppText variant="caption" color="textMuted">
                  {r.authorName}
                </AppText>
                {r.photos.length ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photos}>
                    {r.photos.map((f) => (
                      <Image key={f.id} source={{ uri: f.url }} style={styles.photo} />
                    ))}
                  </ScrollView>
                ) : null}
              </Card>
            ))
          ) : (
            <AppText variant="small" color="textMuted" testID="project-no-reports">
              {t('project.noReports')}
            </AppText>
          )}
        </>
      ) : null}

      {p.invoice ? (
        <Card style={styles.block} onPress={() => router.push(`/project/${p.id}/invoice` as never)} testID="project-invoice">
          <View style={styles.reportHead}>
            <AppText variant="bodyStrong">{t('invoice.title', { number: p.invoice.number })}</AppText>
            <StatusPill label={t(`common:invoiceStatus.${p.invoice.status}`)} tone={p.invoice.status === 'PAID' ? 'success' : 'warning'} />
          </View>
          <AppText variant="h3">{formatMoney(p.invoice.total, locale)}</AppText>
          <AppText variant="small" color="primary">
            {t('project.viewInvoice')}
          </AppText>
        </Card>
      ) : null}

      {p.guaranteeUntil ? (
        <AppText variant="small" color="primaryDark" style={styles.block} testID="project-guarantee-until">
          {t('tracking.guaranteeUntil', { date: formatDate(p.guaranteeUntil) })}
        </AppText>
      ) : null}
      {RATEABLE.includes(p.status) && !p.rated ? (
        <Button title={t('tracking.rate')} onPress={() => router.push(`/project/${p.id}/rate` as never)} style={styles.action} testID="project-rate" />
      ) : null}
      {guaranteeOpen ? (
        <Button variant="outline" title={t('tracking.guarantee')} onPress={() => router.push(`/project/${p.id}/guarantee` as never)} style={styles.action} testID="project-guarantee" />
      ) : null}
      {p.canCancel ? <Button variant="ghost" title={t('project.cancel')} onPress={() => setCancelOpen(true)} style={styles.action} testID="project-cancel" /> : null}

      <ConfirmSheet
        visible={!!accepting}
        title={t('project.acceptTitle')}
        message={accepting ? t('project.acceptText', { name: accepting.provider.name, amount: formatMoney(accepting.totalAmount, locale) }) : ''}
        confirmLabel={t('project.acceptConfirm')}
        danger={false}
        loading={busy}
        onConfirm={() => void accept()}
        onClose={() => setAccepting(null)}
        testID="project-accept-sheet"
      />
      <ConfirmSheet
        visible={cancelOpen}
        title={t('project.cancelTitle')}
        message={t('project.cancelText')}
        confirmLabel={t('project.cancel')}
        loading={busy}
        onConfirm={() => void cancel()}
        onClose={() => setCancelOpen(false)}
        testID="project-cancel-sheet"
      />
    </Screen>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.line}>
      <AppText variant="caption" color="textMuted">
        {label}
      </AppText>
      <AppText variant="body">{value}</AppText>
    </View>
  );
}

/** One quote: provider (name, photo, rating, jobs, VAT payer), total, workers × days, per worker-day, note. Never the platform fee. */
function QuoteCard({ quote, cheapest, onAccept, testID }: { quote: QuoteView; cheapest?: boolean; onAccept?: () => void; testID: string }) {
  const { t, locale } = useT();
  const pr = quote.provider;
  return (
    <Card style={[styles.block, cheapest ? styles.cheapest : null]} testID={testID}>
      <View style={styles.reportHead}>
        <View style={styles.provider}>
          <Avatar uri={pr.photo?.url} firstName={pr.name} size={40} />
          <View style={styles.providerText}>
            <AppText variant="bodyStrong">{pr.name}</AppText>
            <View style={styles.provider}>
              {pr.ratingAvg !== null ? <Stars value={pr.ratingAvg} size={11} showValue /> : null}
              <AppText variant="caption" color="textMuted" style={styles.jobs}>
                {t('detail.jobs', { count: pr.completedCount })}
              </AppText>
            </View>
          </View>
        </View>
        {cheapest ? <Badge label={t('project.cheapest')} tone="success" testID={`${testID}-cheapest`} /> : quote.status !== 'SUBMITTED' ? <Badge label={t(`common:quoteStatus.${quote.status}`)} tone="neutral" /> : null}
      </View>
      <AppText variant="h2" style={styles.amount} testID={`${testID}-total`}>
        {formatMoney(quote.totalAmount, locale)}
      </AppText>
      <AppText variant="small" color="textMuted">
        {t('project.quoteLine', { workers: quote.workers, days: quote.days })} · {t('project.perWorkerDay', { amount: formatMoney(quotePerWorkerDay(quote), locale) })}
      </AppText>
      {pr.isVatPayer ? (
        <AppText variant="caption" color="textMuted">
          {t('project.vatPayer')}
        </AppText>
      ) : null}
      {quote.note ? (
        <AppText variant="body" style={styles.desc}>
          {quote.note}
        </AppText>
      ) : null}
      {onAccept ? <Button title={t('project.accept')} onPress={onAccept} style={styles.action} testID={`${testID}-accept`} /> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  block: { marginBottom: spacing.md },
  title: { marginTop: spacing.sm, marginBottom: spacing.sm },
  gap: { height: spacing.sm },
  line: { marginTop: spacing.sm },
  desc: { marginTop: spacing.sm },
  photos: { marginTop: spacing.md },
  photo: { width: 72, height: 72, borderRadius: 10, marginRight: spacing.sm, backgroundColor: colors.border },
  reportHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  provider: { flexDirection: 'row', alignItems: 'center' },
  providerText: { marginLeft: spacing.sm },
  jobs: { marginLeft: spacing.xs },
  amount: { marginTop: spacing.sm },
  action: { marginTop: spacing.sm },
  cheapest: { borderColor: colors.primary, borderWidth: 1, borderRadius: radii.lg },
});
