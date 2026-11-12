import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { api, formatMoney, type CheckoutResponse, type PaymentMethod } from '@tezfiks/shared';
import {
  AppText,
  Banner,
  Button,
  Card,
  ErrorState,
  Header,
  LoadingState,
  Screen,
  colors,
  spacing,
  useApi,
  useT,
  useToast,
} from '@tezfiks/mobile';
import { qk, useAssignment } from '../../../data/queries';
import { useCheckout } from '../../../hooks/useCheckout';
import { useKeyRegistry } from '../../../hooks/useAssignmentLive';
import { PAYMENT_RETURN_URL, type CheckoutOutcome } from '../../../lib/payments';
import { requestErrorInfo } from '../../../lib/requestErrors';

/**
 * Board 02 C1 "Ödəniş": the agreed price (labour + materials), Nağd — qapıda ödəmə or Kartla ödəmə (test checkout in an auth
 * session) with the TezFiks Zəmanəti explainer, and the way to dispute the price. Card success leads to the tip page.
 */
export default function PayRoute() {
  const { t, locale } = useT();
  const client = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const keys = useKeyRegistry();
  const checkout = useCheckout();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useAssignment(id);
  const [method, setMethod] = useState<PaymentMethod>('CARD');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'danger' | 'warning'; text: string } | null>(null);

  const back = () => (router.canGoBack() ? router.back() : router.replace(`/assignment/${id}` as never));

  if (q.isPending) return <LoadingState testID="pay-loading" />;
  if (q.isError || !q.data) {
    return (
      <Screen testID="pay-screen">
        <Header onBack={back} />
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </Screen>
    );
  }
  const a = q.data;
  const total = a.price?.total ?? 0;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: qk.assignment(a.id) });
    void queryClient.invalidateQueries({ queryKey: qk.request(a.requestId) });
    void queryClient.invalidateQueries({ queryKey: qk.requestsRoot });
  };

  const handleOutcome = (outcome: CheckoutOutcome) => {
    refresh();
    if (outcome.status === 'SUCCEEDED') {
      toast.show(t('pay.succeeded'), { kind: 'success' });
      router.replace(`/assignment/${a.id}/tip` as never);
    } else if (outcome.status === 'FAILED') {
      setNotice({ tone: 'danger', text: t('pay.failed') });
    } else if (outcome.status === 'CANCELLED') {
      setNotice({ tone: 'warning', text: t('pay.cancelled') });
    } else {
      setNotice({ tone: 'warning', text: t('pay.pending') });
    }
  };

  /** A card checkout that is still open is reopened instead of creating a second one. */
  const openPending = async (): Promise<CheckoutResponse | null> => {
    if (!a.payment || a.payment.status !== 'CREATED') return null;
    try {
      const p = await client.call(api.payments.get, { params: { id: a.payment.intentId } });
      return p.status === 'CREATED' && p.checkoutUrl ? { paymentIntentId: p.id, checkoutUrl: p.checkoutUrl } : null;
    } catch {
      return null;
    }
  };

  const pay = async () => {
    setBusy(true);
    setNotice(null);
    try {
      if (method === 'CARD') {
        const pending = await openPending();
        if (pending) {
          handleOutcome(await checkout.run(pending));
          return;
        }
      }
      const res = await client.call(api.assignments.confirmPrice, {
        params: { id: a.id },
        body: method === 'CARD' ? { method, returnUrl: PAYMENT_RETURN_URL } : { method },
        idempotencyKey: keys.get(`confirm-${method}`),
      });
      keys.settle(`confirm-${method}`);
      queryClient.setQueryData(qk.assignment(a.id), res.assignment);
      if (method === 'CASH' || !res.payment) {
        refresh();
        // A card confirm without a checkout means nothing is charged (e.g. a 0 ₼ guarantee re-fix): not a cash payment.
        toast.show(t(method === 'CASH' ? 'pay.cashDone' : 'pay.noCharge'), { kind: 'success' });
        router.replace(`/assignment/${a.id}/rate` as never);
        return;
      }
      handleOutcome(await checkout.run(res.payment));
    } catch (err) {
      keys.settle(`confirm-${method}`, err);
      setNotice({ tone: 'danger', text: t(requestErrorInfo(err).messageKey) });
      void q.refetch();
    } finally {
      setBusy(false);
    }
  };

  if (!a.actions.confirmPrice) {
    return (
      <Screen edges={['top', 'bottom']} testID="pay-screen">
        <Header onBack={back} title={t('pay.title')} />
        <Banner tone="info" message={t(a.status === 'COMPLETED' ? 'pay.alreadyDone' : 'pay.notProposed')} testID="pay-unavailable" />
        <Button title={t('pay.toJob')} onPress={() => router.replace(`/assignment/${a.id}` as never)} testID="pay-to-job" />
      </Screen>
    );
  }

  const option = (m: PaymentMethod, title: string, hint: string) => (
    <Card selected={method === m} onPress={() => setMethod(m)} style={styles.option} testID={`pay-method-${m}`} accessibilityLabel={title}>
      <View style={styles.row}>
        <View style={styles.flex}>
          <AppText variant="bodyStrong">{title}</AppText>
          <AppText variant="caption" color="textMuted">
            {hint}
          </AppText>
          {m === 'CARD' ? (
            <AppText variant="caption" color="primaryDark" style={styles.badge}>
              {t('pay.guaranteeIncluded')}
            </AppText>
          ) : null}
        </View>
        <Ionicons name={method === m ? 'radio-button-on' : 'radio-button-off'} size={22} color={method === m ? colors.primary : colors.borderStrong} />
      </View>
    </Card>
  );

  return (
    <Screen
      scroll
      edges={['top', 'bottom']}
      testID="pay-screen"
      footer={
        <Button
          title={method === 'CARD' ? t('pay.payAmount', { amount: formatMoney(total, locale) }) : t('pay.confirmCash', { amount: formatMoney(total, locale) })}
          onPress={() => void pay()}
          loading={busy || checkout.running}
          testID="pay-submit"
        />
      }
    >
      <Header onBack={back} title={t('pay.title')} />
      <Card style={styles.block} testID="pay-summary">
        <Line label={t('pay.handyman')} value={`${a.provider.firstName} ${a.provider.lastName}`.trim()} />
        {a.price ? (
          <>
            <Line label={t('common:fields.labor')} value={formatMoney(a.price.labor, locale)} testID="pay-labor" />
            <Line label={t('common:fields.materials')} value={formatMoney(a.price.materials, locale)} testID="pay-materials" />
          </>
        ) : null}
        <View style={styles.divider} />
        <Line label={t('pay.agreed')} value={formatMoney(total, locale)} strong testID="pay-total" />
      </Card>

      <AppText variant="bodyStrong" style={styles.label}>
        {t('pay.methodTitle')}
      </AppText>
      {option('CASH', t('pay.cash'), t('pay.cashHint'))}
      {option('CARD', t('pay.card'), t('pay.cardHint'))}

      {method === 'CARD' ? (
        <Card dark style={styles.block} testID="pay-guarantee">
          <AppText variant="bodyStrong" color="primary">
            {t('pay.guaranteeTitle')}
          </AppText>
          <AppText variant="small" color="textInverseMuted">
            {t('pay.guaranteeText')}
          </AppText>
          <AppText variant="caption" color="textInverseMuted" style={styles.badge}>
            {t('pay.testCard')}
          </AppText>
        </Card>
      ) : null}

      {notice ? <Banner tone={notice.tone} message={notice.text} testID="pay-notice" /> : null}

      {a.actions.disputePrice ? (
        <Button variant="ghost" title={t('pay.dispute')} onPress={() => router.push(`/assignment/${a.id}/dispute` as never)} testID="pay-dispute" />
      ) : null}
    </Screen>
  );
}

function Line({ label, value, strong, testID }: { label: string; value: string; strong?: boolean; testID?: string }) {
  return (
    <View style={styles.lineRow}>
      <AppText variant={strong ? 'bodyStrong' : 'small'} color={strong ? 'text' : 'textMuted'}>
        {label}
      </AppText>
      <AppText variant={strong ? 'h3' : 'bodyStrong'} testID={testID}>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  block: { marginBottom: spacing.md },
  option: { marginBottom: spacing.sm },
  label: { marginTop: spacing.sm, marginBottom: spacing.sm },
  badge: { marginTop: spacing.xs },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
  lineRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.xs },
});
