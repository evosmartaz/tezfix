import React from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { api, formatDate, formatMoney, type EarningsView } from '@tezfiks/shared';
import { AppText, Badge, Button, Card, EmptyState, ErrorState, Header, ListItem, LoadingState, Screen, errorMessage, spacing, useApi, useT } from '@tezfiks/mobile';
import { qk } from '../hooks/queries';

const PAYOUT_TONE = { PENDING: 'warning', PAID: 'success', FAILED: 'danger' } as const;

/** Earnings & payouts: unpaid card earnings and tips, this week, weekly payouts, payout card (spec 4.9). */
export default function Earnings() {
  const { t, locale } = useT();
  const client = useApi();
  const params = useLocalSearchParams<{ companyId?: string }>();
  const companyId = typeof params.companyId === 'string' && params.companyId ? params.companyId : null;
  const q = useQuery({
    queryKey: qk.earnings(companyId),
    queryFn: (): Promise<EarningsView> =>
      companyId ? client.call(api.company.earnings, { params: { companyId } }) : client.call(api.pro.earnings),
  });
  const e = q.data;
  const m = (n: number) => formatMoney(n, locale);
  return (
    <Screen scroll testID="earnings-screen" onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      <Header title={t('earnings.title')} onBack={() => (router.canGoBack() ? router.back() : router.replace('/balance' as never))} />
      {q.isLoading ? <LoadingState /> : null}
      {q.isError ? <ErrorState error={q.error} message={errorMessage(t, q.error)} onRetry={() => void q.refetch()} /> : null}
      {e ? (
        <View>
          <Card dark>
            <AppText variant="small" color="textInverseMuted">
              {t('earnings.balance')}
            </AppText>
            <AppText variant="display" color="textInverse" testID="earnings-balance">
              {m(e.earningsBalance)}
            </AppText>
            {e.pendingPayouts > 0 ? (
              <AppText variant="small" color="textInverseMuted" testID="earnings-pending">
                {t('earnings.pending', { amount: m(e.pendingPayouts) })}
              </AppText>
            ) : null}
            <AppText variant="caption" color="textInverseMuted" style={styles.line}>
              {t('earnings.hint')}
            </AppText>
          </Card>
          <Card style={styles.block} testID="earnings-week">
            <AppText variant="h3">{t('earnings.thisWeek')}</AppText>
            <AppText variant="body" style={styles.line}>
              {t('earnings.card', { count: e.thisWeek.cardJobs, amount: m(e.thisWeek.cardTotal) })}
            </AppText>
            <AppText variant="body">{t('earnings.cash', { count: e.thisWeek.cashJobs, amount: m(e.thisWeek.cashTotal) })}</AppText>
            <AppText variant="body" color="primary">
              {t('earnings.tips', { amount: m(e.thisWeek.tips) })}
            </AppText>
          </Card>
          <Card style={styles.block} testID="earnings-method">
            <AppText variant="h3">{t('earnings.method')}</AppText>
            <AppText variant="body" color={e.payoutMethod ? 'text' : 'textMuted'} style={styles.line} testID="earnings-method-value">
              {e.payoutMethod ? `${e.payoutMethod.maskedNumber} • ${e.payoutMethod.holderName}` : t('earnings.noMethod')}
            </AppText>
            <Button
              variant="outline"
              size="sm"
              fullWidth={false}
              style={styles.line}
              title={e.payoutMethod ? t('earnings.changeMethod') : t('earnings.addMethod')}
              onPress={() => router.push((companyId ? `/payout-method?companyId=${companyId}` : '/payout-method') as never)}
              testID="earnings-method-edit"
            />
          </Card>
          <AppText variant="h3" style={styles.block}>
            {t('earnings.payouts')}
          </AppText>
          {e.payouts.length ? (
            <Card padded={false} style={styles.list}>
              {e.payouts.map((p, i) => (
                <ListItem
                  key={p.id}
                  title={m(p.amount)}
                  subtitle={[
                    t('earnings.period', { from: formatDate(p.periodStart), to: formatDate(p.periodEnd) }),
                    p.failureReason ? t('earnings.failure', { reason: p.failureReason }) : null,
                  ]
                    .filter(Boolean)
                    .join('\n')}
                  right={<Badge label={t(`common:payoutStatus.${p.status}`)} tone={PAYOUT_TONE[p.status]} />}
                  divider={i < e.payouts.length - 1}
                  testID={`payout-${p.id}`}
                />
              ))}
            </Card>
          ) : (
            <EmptyState icon="cash-outline" title={t('earnings.noPayouts')} testID="earnings-no-payouts" />
          )}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  block: { marginTop: spacing.md },
  line: { marginTop: spacing.sm },
  list: { marginTop: spacing.sm, paddingHorizontal: spacing.lg },
});
