import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { api, formatMoney } from '@tezfiks/shared';
import { AppText, Button, ErrorState, LoadingState, Screen, colors, spacing, useApi, useT } from '@tezfiks/mobile';
import { qk } from '../data/queries';
import { SETTLE_MAX_MS, paymentPollMs } from '../lib/payments';

/**
 * Landing screen for `tezfiks://payment?paymentIntentId=...` when the checkout returns to an app that was not running.
 * The status in the link is only a hint: the screen asks GET /payments/:id until the intent is settled.
 */
export default function PaymentReturnRoute() {
  const { t, locale } = useT();
  const client = useApi();
  const params = useLocalSearchParams<{ paymentIntentId?: string }>();
  const id = typeof params.paymentIntentId === 'string' ? params.paymentIntentId : '';
  // Asks for a minute at most; then the customer checks again by hand (an abandoned checkout stays CREATED).
  const [checkRound, setCheckRound] = useState(0);
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    setExpired(false);
    const timer = setTimeout(() => setExpired(true), SETTLE_MAX_MS);
    return () => clearTimeout(timer);
  }, [checkRound]);
  const q = useQuery({
    queryKey: qk.payment(id),
    queryFn: () => client.call(api.payments.get, { params: { id } }),
    enabled: !!id,
    refetchInterval: (query) => paymentPollMs(query.state.data?.status, expired),
  });
  const home = () => router.replace('/');

  if (!id) {
    return (
      <Screen testID="payment-screen">
        <ErrorState message={t('pay.pending')} onRetry={home} />
      </Screen>
    );
  }
  if (q.isPending) return <LoadingState testID="payment-loading" />;
  if (q.isError || !q.data) {
    return (
      <Screen testID="payment-screen">
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </Screen>
    );
  }
  const p = q.data;
  const ok = p.status === 'SUCCEEDED';
  const waiting = p.status === 'CREATED';
  const key = ok ? 'pay.succeeded' : p.status === 'FAILED' ? 'pay.failed' : p.status === 'CANCELLED' ? 'pay.cancelled' : expired ? 'pay.checkStopped' : 'pay.checking';
  return (
    <Screen testID="payment-screen">
      <View style={styles.center}>
        <Ionicons name={ok ? 'checkmark-circle' : p.status === 'CREATED' ? 'time-outline' : 'close-circle'} size={72} color={ok ? colors.primary : p.status === 'CREATED' ? colors.accent : colors.danger} />
        <AppText variant="h2" align="center" style={styles.line} testID="payment-status">
          {t(key)}
        </AppText>
        <AppText variant="body" color="textMuted" align="center">
          {formatMoney(p.amount, locale)}
        </AppText>
        {waiting && expired ? (
          <Button
            variant="outline"
            title={t('pay.checkAgain')}
            onPress={() => {
              setCheckRound((n) => n + 1);
              void q.refetch();
            }}
            style={styles.line}
            testID="payment-recheck"
          />
        ) : null}
        <Button
          title={t(p.purpose === 'WALLET_TOPUP' ? 'payment.toWallet' : 'payment.toOrders')}
          onPress={() => router.replace((p.purpose === 'WALLET_TOPUP' ? '/wallet' : '/orders') as never)}
          style={styles.line}
          testID="payment-continue"
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  line: { marginTop: spacing.lg, alignSelf: 'stretch' },
});
