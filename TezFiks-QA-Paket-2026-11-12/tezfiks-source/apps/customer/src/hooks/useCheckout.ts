import { useCallback, useRef, useState } from 'react';
import * as WebBrowser from 'expo-web-browser';
import { api, type CheckoutResponse } from '@tezfiks/shared';
import { useApi } from '@tezfiks/mobile';
import { completeCheckout, type CheckoutOutcome } from '../lib/payments';

/**
 * Opens a test checkout (POST /wallet/topup, /assignments/:id/confirm-price CARD or /tip return one) in an auth session
 * that ends on `tezfiks://payment`, then reads the settled intent from GET /payments/:id.
 */
export function useCheckout(): { run: (checkout: CheckoutResponse) => Promise<CheckoutOutcome>; running: boolean } {
  const client = useApi();
  const [running, setRunning] = useState(false);
  const busy = useRef(false);
  const run = useCallback(
    async (checkout: CheckoutResponse) => {
      if (busy.current) return { status: 'PENDING' as const, payment: null, returned: false };
      busy.current = true;
      setRunning(true);
      try {
        return await completeCheckout(checkout, {
          openAuthSession: (url, redirect) => WebBrowser.openAuthSessionAsync(url, redirect),
          getPayment: (id) => client.call(api.payments.get, { params: { id } }),
        });
      } finally {
        busy.current = false;
        setRunning(false);
      }
    },
    [client],
  );
  return { run, running };
}
