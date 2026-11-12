import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { api, formatMoney } from '@tezfiks/shared';
import { AppText, Avatar, Banner, Button, ErrorState, Header, LoadingState, Screen, colors, spacing, useApi, useT, useToast } from '@tezfiks/mobile';
import { AmountPicker, type AmountValue } from '../../../components/AmountPicker';
import { qk, useAssignment } from '../../../data/queries';
import { useCheckout } from '../../../hooks/useCheckout';
import { useKeyRegistry } from '../../../hooks/useAssignmentLive';
import { PAYMENT_RETURN_URL, SETTLE_MAX_MS, TIP_PRESETS, amountFromPicker, settlePollMs, validatePaymentAmount } from '../../../lib/payments';
import { requestErrorInfo } from '../../../lib/requestErrors';

/** Tip page after an in-app (card) payment (spec 4.5): preset amounts or a custom one, paid through the test checkout. */
export default function TipRoute() {
  const { t, locale } = useT();
  const client = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const keys = useKeyRegistry();
  const checkout = useCheckout();
  const { id } = useLocalSearchParams<{ id: string }>();
  // Card payments complete asynchronously (payment.succeeded): poll for a minute while the job waits for its payment.
  const [checkRound, setCheckRound] = useState(0);
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    setExpired(false);
    const timer = setTimeout(() => setExpired(true), SETTLE_MAX_MS);
    return () => clearTimeout(timer);
  }, [checkRound]);
  const q = useAssignment(id, { pollMs: (x) => settlePollMs(x?.status, expired) });
  const [value, setValue] = useState<AmountValue>({ preset: TIP_PRESETS[1], custom: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const a = q.data;

  const next = () => {
    if (a?.actions.rate) router.replace(`/assignment/${id}/rate` as never);
    else router.replace(`/assignment/${id}` as never);
  };

  if (q.isPending) return <LoadingState testID="tip-loading" />;
  if (q.isError || !a) {
    return (
      <Screen testID="tip-screen">
        <Header onBack={next} />
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </Screen>
    );
  }

  const amount = amountFromPicker(value);

  const send = async () => {
    const problem = validatePaymentAmount(amount);
    setError(problem ? t(problem) : null);
    if (problem || amount === null) return;
    setBusy(true);
    try {
      const res = await client.call(api.assignments.tip, {
        params: { id: a.id },
        body: { amount, returnUrl: PAYMENT_RETURN_URL },
        idempotencyKey: keys.get(`tip-${amount}`),
      });
      keys.settle(`tip-${amount}`);
      const outcome = await checkout.run(res);
      void queryClient.invalidateQueries({ queryKey: qk.assignment(a.id) });
      if (outcome.status === 'SUCCEEDED') {
        toast.show(t('tip.thanks'), { kind: 'success' });
        next();
      } else {
        setError(t(outcome.status === 'FAILED' ? 'pay.failed' : outcome.status === 'CANCELLED' ? 'pay.cancelled' : 'pay.pending'));
      }
    } catch (err) {
      keys.settle(`tip-${amount}`, err);
      setError(t(requestErrorInfo(err).messageKey));
    } finally {
      setBusy(false);
    }
  };

  const p = a.provider;
  return (
    <Screen scroll edges={['top', 'bottom']} testID="tip-screen">
      <Header title={t('tip.title')} />
      <View style={styles.hero}>
        <Ionicons name="checkmark-circle" size={56} color={colors.primary} />
        <AppText variant="body" align="center" style={styles.line}>
          {t('tip.subtitle')}
        </AppText>
        <Avatar uri={p.photo?.url} firstName={p.firstName} lastName={p.lastName} size={56} />
        <AppText variant="h3" style={styles.line}>{`${p.firstName} ${p.lastName}`.trim()}</AppText>
      </View>
      {!a.actions.tip ? (
        <>
          <Banner
            tone="info"
            message={t(a.status !== 'PRICE_PROPOSED' ? 'tip.notAvailable' : expired ? 'pay.checkStopped' : 'pay.checking')}
            testID="tip-unavailable"
          />
          {a.status === 'PRICE_PROPOSED' && expired ? (
            <Button
              variant="outline"
              title={t('pay.checkAgain')}
              onPress={() => {
                setCheckRound((n) => n + 1);
                void q.refetch();
              }}
              testID="tip-recheck"
            />
          ) : null}
        </>
      ) : (
        <>
          <AmountPicker presets={TIP_PRESETS} value={value} onChange={setValue} label={t('tip.custom')} error={error} testID="tip-amount" />
          <Button
            variant="accent"
            title={amount ? t('tip.send', { amount: formatMoney(amount, locale) }) : t('tracking.tip')}
            onPress={() => void send()}
            loading={busy || checkout.running}
            testID="tip-send"
          />
        </>
      )}
      <View style={styles.gap} />
      <Button variant="ghost" title={t('tip.skip')} onPress={next} testID="tip-skip" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', marginBottom: spacing.lg },
  line: { marginVertical: spacing.sm },
  gap: { height: spacing.sm },
});
