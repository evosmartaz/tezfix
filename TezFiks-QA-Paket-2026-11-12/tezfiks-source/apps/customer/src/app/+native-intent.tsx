import { parsePaymentReturn } from '../lib/payments';

/**
 * Incoming system links. The test checkout redirects to `tezfiks://payment?paymentIntentId=...&status=...`:
 * while the app runs, the screen that opened the checkout is waiting for that payment (the auth session returns the URL
 * and the screen asks the API), so the router stays where it is. On a cold start the payment landing screen shows the result.
 */
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string | null {
  try {
    const ret = parsePaymentReturn(path);
    if (!ret) return path;
    if (!initial) return null;
    if (!ret.paymentIntentId) return '/';
    return `/payment?paymentIntentId=${encodeURIComponent(ret.paymentIntentId)}${ret.status ? `&status=${ret.status}` : ''}`;
  } catch {
    return path;
  }
}
