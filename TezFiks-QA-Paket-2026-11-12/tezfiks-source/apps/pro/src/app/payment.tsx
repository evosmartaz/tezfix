import React, { useEffect } from 'react';
import { router } from 'expo-router';
import { LoadingState, Screen } from '@tezfiks/mobile';

/**
 * Return target of the test checkout (tezfiksusta://payment). The top-up sheet polls the payment itself, so this
 * screen only hands control back to where the user started (or the Balance tab after a cold start).
 */
export default function PaymentReturn() {
  useEffect(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/balance' as never);
  }, []);
  return (
    <Screen testID="payment-return">
      <LoadingState />
    </Screen>
  );
}
