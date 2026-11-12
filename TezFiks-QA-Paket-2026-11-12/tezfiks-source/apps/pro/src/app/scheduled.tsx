import React, { useRef, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, formatDateTime, formatMoney, shortName, type OfferView } from '@tezfiks/shared';
import {
  AppText,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Header,
  LoadingState,
  Screen,
  clockStore,
  colors,
  errorCodeOf,
  errorMessage,
  newIdempotencyKey,
  spacing,
  useApi,
  useSocketEvent,
  useT,
  useToast,
} from '@tezfiks/mobile';
import { qk } from '../hooks/queries';
import { createAcceptKeyRegistry, distanceKm } from '../lib/offers';

/** "Planlı sifarişlər": open offers for scheduled requests (GET /pro/scheduled) with accept / decline. */
export default function ScheduledOffers() {
  const { t, locale } = useT();
  const client = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const keys = useRef(createAcceptKeyRegistry(newIdempotencyKey)).current;
  const [busyId, setBusyId] = useState<string | null>(null);
  const list = useQuery({
    queryKey: qk.scheduled,
    queryFn: async () => {
      const res = await client.call(api.pro.scheduledOffers);
      clockStore.getState().syncWithServer(res.serverNow);
      return res;
    },
    refetchInterval: 30_000,
  });
  useSocketEvent('offer:new', () => void list.refetch());
  useSocketEvent('offer:closed', () => void list.refetch());

  const accept = async (o: OfferView) => {
    setBusyId(o.id);
    try {
      const res = await client.call(api.pro.acceptOffer, { params: { id: o.id }, idempotencyKey: keys.keyFor(o.id) });
      keys.forget(o.id);
      toast.show(t('offer.accepted'), { kind: 'success' });
      void queryClient.invalidateQueries({ queryKey: ['pro'] });
      router.push(`/job/${res.assignment.id}` as never);
    } catch (err) {
      const code = errorCodeOf(err);
      if (code === 'INSUFFICIENT_BALANCE') {
        toast.show(t('offer.insufficientBalance'), { kind: 'error', actionLabel: t('home.topUp'), onAction: () => router.push('/balance' as never) });
      } else {
        if (code !== 'NETWORK' && code !== 'TIMEOUT') keys.forget(o.id);
        toast.show(code === 'OFFER_UNAVAILABLE' ? t('offer.taken') : errorMessage(t, err), { kind: 'error' });
        void list.refetch();
      }
    } finally {
      setBusyId(null);
    }
  };

  const decline = async (o: OfferView) => {
    setBusyId(o.id);
    await client.call(api.pro.declineOffer, { params: { id: o.id } }).catch(() => undefined);
    setBusyId(null);
    void list.refetch();
  };

  return (
    <Screen testID="scheduled-screen">
      <Header title={t('scheduled.title')} subtitle={t('scheduled.subtitle')} onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
      {list.isLoading ? <LoadingState /> : null}
      {list.isError ? <ErrorState error={list.error} message={errorMessage(t, list.error)} onRetry={() => void list.refetch()} /> : null}
      {list.data ? (
        <FlatList
          data={list.data.items}
          keyExtractor={(o) => o.id}
          onRefresh={() => void list.refetch()}
          refreshing={list.isRefetching}
          ListEmptyComponent={<EmptyState icon="calendar-outline" title={t('scheduled.empty')} />}
          renderItem={({ item: o }) => {
            const km = distanceKm(o.distanceM);
            return (
              <Card style={styles.card} testID={`scheduled-${o.id}`}>
                <View style={styles.row}>
                  <AppText variant="bodyStrong" style={styles.flex}>
                    {o.category.name}
                  </AppText>
                  {o.isEmergency ? <Badge label={t('offer.emergency')} tone="danger" /> : null}
                </View>
                <AppText variant="small" color="primary" style={styles.line}>
                  {o.scheduledAt ? formatDateTime(o.scheduledAt) : ''}
                </AppText>
                <AppText variant="small" style={styles.line}>
                  {o.address.area}
                  {km !== null ? ` • ${t('offer.km', { km: km.toFixed(1) })}` : ''}
                </AppText>
                <AppText variant="small" color="textMuted" style={styles.line}>
                  {shortName(o.customer.firstName, o.customer.lastInitial)}
                  {o.customer.ratingAvg !== null ? ` • ★ ${o.customer.ratingAvg.toFixed(1)}` : ''}
                </AppText>
                {o.descriptionShort ? (
                  <AppText variant="small" color="textMuted" style={styles.line} numberOfLines={2}>
                    {o.descriptionShort}
                  </AppText>
                ) : null}
                <AppText variant="caption" style={[styles.line, styles.fee]}>
                  {t('offer.feeWarning', { fee: formatMoney(o.fee, locale, { compact: true, plain: true }) })}
                </AppText>
                <View style={[styles.row, styles.actions]}>
                  <Button
                    variant="outline"
                    size="sm"
                    title={t('offer.decline')}
                    onPress={() => void decline(o)}
                    disabled={busyId === o.id}
                    fullWidth={false}
                    style={styles.action}
                    testID={`scheduled-decline-${o.id}`}
                  />
                  <Button
                    size="sm"
                    title={t('offer.accept')}
                    onPress={() => void accept(o)}
                    loading={busyId === o.id}
                    fullWidth={false}
                    style={styles.action}
                    testID={`scheduled-accept-${o.id}`}
                  />
                </View>
              </Card>
            );
          }}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  line: { marginTop: spacing.xs },
  fee: { color: colors.accent },
  actions: { marginTop: spacing.md },
  action: { flex: 1, marginHorizontal: spacing.xs },
});
