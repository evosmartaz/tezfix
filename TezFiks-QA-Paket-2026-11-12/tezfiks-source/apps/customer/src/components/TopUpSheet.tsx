import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { api, formatMoney } from '@tezfiks/shared';
import { AppText, Banner, BottomSheet, Button, spacing, useApi, useT, useToast } from '@tezfiks/mobile';
import { qk } from '../data/queries';
import { useCheckout } from '../hooks/useCheckout';
import { useKeyRegistry } from '../hooks/useAssignmentLive';
import { PAYMENT_RETURN_URL, TOPUP_PRESETS, amountFromPicker, validatePaymentAmount } from '../lib/payments';
import { requestErrorInfo } from '../lib/requestErrors';
import { AmountPicker, type AmountValue } from './AmountPicker';

export interface TopUpSheetProps {
  visible: boolean;
  /** Pre-selected amount (qəpik), e.g. the debt or the emergency shortfall. */
  initialAmount?: number | null;
  onClose: () => void;
}

function initialValue(amount: number | null | undefined): AmountValue {
  if (!amount) return { preset: TOPUP_PRESETS[1], custom: '' };
  if ((TOPUP_PRESETS as readonly number[]).includes(amount)) return { preset: amount, custom: '' };
  return { preset: null, custom: String(amount / 100).replace('.', ',') };
}

/** "Balansı artır": amount → POST /wallet/topup → test checkout (auth session) → settled intent. */
export function TopUpSheet({ visible, initialAmount, onClose }: TopUpSheetProps) {
  const { t, locale } = useT();
  const client = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const keys = useKeyRegistry();
  const checkout = useCheckout();
  const [value, setValue] = useState<AmountValue>(() => initialValue(initialAmount));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) {
      setValue(initialValue(initialAmount));
      setError(null);
    }
  }, [visible, initialAmount]);

  const amount = amountFromPicker(value);

  const pay = async () => {
    const problem = validatePaymentAmount(amount);
    setError(problem ? t(problem) : null);
    if (problem || amount === null) return;
    setBusy(true);
    const action = `topup-${amount}`;
    try {
      const res = await client.call(api.wallet.topup, { body: { amount, returnUrl: PAYMENT_RETURN_URL }, idempotencyKey: keys.get(action) });
      keys.settle(action);
      const outcome = await checkout.run(res);
      void queryClient.invalidateQueries({ queryKey: qk.wallet });
      void queryClient.invalidateQueries({ queryKey: qk.account });
      if (outcome.status === 'SUCCEEDED') {
        toast.show(t('wallet.topUpSuccess', { amount: formatMoney(outcome.payment?.amount ?? amount, locale) }), { kind: 'success' });
        onClose();
      } else {
        setError(t(outcome.status === 'FAILED' ? 'pay.failed' : outcome.status === 'CANCELLED' ? 'pay.cancelled' : 'pay.pending'));
      }
    } catch (err) {
      keys.settle(action, err);
      setError(t(requestErrorInfo(err).messageKey));
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('wallet.topUpTitle')} testID="topup-sheet">
      <AmountPicker presets={TOPUP_PRESETS} value={value} onChange={setValue} label={t('wallet.amountLabel')} error={error} testID="topup-amount" />
      <Banner tone="info" message={t('pay.testCard')} testID="topup-test-card" />
      <Button
        title={amount ? t('pay.payAmount', { amount: formatMoney(amount, locale) }) : t('wallet.topUpTitle')}
        onPress={() => void pay()}
        loading={busy || checkout.running}
        testID="topup-pay"
      />
      <View style={styles.gap} />
      <AppText variant="caption" color="textMuted" align="center">
        {t('wallet.feeNote')}
      </AppText>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({ gap: { height: spacing.sm } });
