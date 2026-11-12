import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type OfferView, type ProAssignment } from '@tezfiks/shared';
import { clockStore, errorCodeOf, errorMessage, newIdempotencyKey, serverNow, useApi, useSocketEvent, useT, useToast } from '@tezfiks/mobile';
import { addCompanyOffer, applyCompanyPoll, emptyCompanyOffers, openCompanyOffers, removeCompanyOffer, type CompanyOfferState } from '../lib/company';
import { createAcceptKeyRegistry } from '../lib/offers';
import { clearOfferAlert, playOfferAlert } from '../online/alert';
import { qk } from './queries';

export const COMPANY_OFFER_POLL_MS = 5_000;

/** Offer errors after which the card is gone for good. */
const GONE = new Set(['OFFER_UNAVAILABLE', 'OFFER_EXPIRED', 'NOT_FOUND', 'INVALID_STATE', 'COMPANY_NOT_APPROVED', 'NOT_COMPANY_MANAGER', 'FORBIDDEN']);

export interface CompanyOffersApi {
  offers: OfferView[];
  busyId: string | null;
  accept(offer: OfferView, workerIds: string[]): Promise<ProAssignment[] | null>;
  decline(offer: OfferView): Promise<void>;
}

/**
 * Manager mode incoming orders (board 04): socket `offer:new`/`offer:closed` for the company room plus
 * GET /company/:id/offers/current every 5 s; "Qəbul et və göndər" with a stable idempotency key per offer.
 */
export function useCompanyOffers(companyId: string, enabled: boolean): CompanyOffersApi {
  const client = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { t } = useT();
  const [state, setState] = useState<CompanyOfferState>(emptyCompanyOffers);
  const [, setTick] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const keys = useRef(createAcceptKeyRegistry(newIdempotencyKey)).current;
  const alerted = useRef(new Set<string>());

  const poll = useQuery({
    queryKey: qk.companyOffers(companyId),
    enabled,
    refetchInterval: enabled ? COMPANY_OFFER_POLL_MS : false,
    refetchOnWindowFocus: 'always',
    staleTime: 0,
    queryFn: async () => {
      const requestedAt = serverNow();
      const res = await client.call(api.company.offers, { params: { companyId } });
      clockStore.getState().syncWithServer(res.serverNow);
      return { ...res, requestedAt };
    },
  });
  useEffect(() => {
    if (poll.data) setState((s) => applyCompanyPoll(s, poll.data.items, companyId, poll.data.requestedAt));
  }, [poll.data, companyId]);

  useSocketEvent('offer:new', (o) => {
    if (enabled) setState((s) => addCompanyOffer(s, o, companyId));
  });
  useSocketEvent('offer:closed', (p) => {
    setState((s) => removeCompanyOffer(s, p.offerId));
    void clearOfferAlert(p.offerId);
  });

  const hasOffers = Object.keys(state.offers).length > 0;
  useEffect(() => {
    if (!hasOffers) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [hasOffers]);

  // recomputed on every render; the 1 s tick above drops expired cards on time
  const offers = openCompanyOffers(state, serverNow());

  const tRef = useRef(t);
  tRef.current = t;
  useEffect(() => {
    for (const o of offers) {
      if (alerted.current.has(o.id)) continue;
      alerted.current.add(o.id);
      void playOfferAlert(o.id, { title: tRef.current('offer.newTitle'), body: `${o.category.name} · ${o.address.area}` });
    }
  }, [offers]);

  const accept = useCallback(
    async (o: OfferView, workerIds: string[]) => {
      if (busyId) return null;
      if (!workerIds.length) {
        toast.show(t('company.selectFirst'), { kind: 'error' });
        return null;
      }
      setBusyId(o.id);
      try {
        const res = await client.call(api.company.acceptOffer, {
          params: { companyId, offerId: o.id },
          body: { workerIds },
          idempotencyKey: keys.keyFor(o.id),
        });
        keys.forget(o.id);
        setState((s) => removeCompanyOffer(s, o.id, { dismiss: true }));
        void clearOfferAlert(o.id);
        void queryClient.invalidateQueries({ queryKey: ['company', companyId] });
        toast.show(t('company.accepted'), { kind: 'success' });
        return res.assignments;
      } catch (err) {
        const code = errorCodeOf(err);
        if (code === 'INSUFFICIENT_BALANCE') {
          toast.show(t('offer.insufficientBalance'), { kind: 'error' });
        } else if (code === 'WORKER_UNAVAILABLE') {
          // a picked worker became busy: keep the card (and the key: nothing was held), refresh the candidates
          keys.forget(o.id);
          toast.show(t('company.workerUnavailable'), { kind: 'error' });
          void poll.refetch();
        } else if (GONE.has(code)) {
          keys.forget(o.id);
          setState((s) => removeCompanyOffer(s, o.id, { dismiss: true }));
          void clearOfferAlert(o.id);
          toast.show(code === 'OFFER_UNAVAILABLE' ? t('offer.taken') : errorMessage(t, err), { kind: 'error' });
        } else {
          toast.show(errorMessage(t, err), { kind: 'error' });
        }
        return null;
      } finally {
        setBusyId(null);
      }
    },
    [busyId, client, companyId, keys, poll, queryClient, t, toast],
  );

  const decline = useCallback(
    async (o: OfferView) => {
      setState((s) => removeCompanyOffer(s, o.id, { dismiss: true }));
      keys.forget(o.id);
      void clearOfferAlert(o.id);
      await client.call(api.company.declineOffer, { params: { companyId, offerId: o.id } }).catch(() => undefined);
    },
    [client, companyId, keys],
  );

  return { offers, busyId, accept, decline };
}
