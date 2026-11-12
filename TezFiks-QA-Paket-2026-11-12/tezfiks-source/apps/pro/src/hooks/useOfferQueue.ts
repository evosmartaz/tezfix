import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type OfferView } from '@tezfiks/shared';
import {
  clockStore,
  errorCodeOf,
  errorMessage,
  newIdempotencyKey,
  serverNow,
  useApi,
  useSocketEvent,
  useT,
  useToast,
} from '@tezfiks/mobile';
import {
  addOffers,
  applyPoll,
  configureOfferTtl,
  createAcceptKeyRegistry,
  currentOffer,
  emptyOfferQueue,
  isLiveOffer,
  markAlerted,
  pruneExpired,
  removeOffer,
  type OfferQueueState,
} from '../lib/offers';
import { clearOfferAlert, playOfferAlert } from '../online/alert';
import { qk } from './queries';

export const OFFER_POLL_MS = 5_000;

/** Errors after which the offer is gone for good (taken, expired, not allowed). */
const GONE = new Set(['OFFER_UNAVAILABLE', 'OFFER_EXPIRED', 'NOT_ELIGIBLE', 'NOT_FOUND', 'INVALID_STATE', 'HANDYMAN_NOT_APPROVED', 'FORBIDDEN']);

/** A failed "Qəbul et" of the shown offer (the modal covers the toast host, so the modal shows it itself). */
export interface OfferAcceptError {
  offerId: string;
  code: string;
  message: string;
}

export interface OfferQueueApi {
  offer: OfferView | null;
  waiting: number;
  accepting: boolean;
  /** Last accept failure of the offer on screen, or null. */
  error: OfferAcceptError | null;
  accept(offer: OfferView): Promise<void>;
  decline(offer: OfferView): Promise<void>;
  /** "Balansı artır" from the modal: moves the offers aside (not declined) and opens Balans. */
  topUp(): void;
  /** Shows the offers again (home screen focused, or the balance changed). */
  resume(): void;
}

/**
 * Incoming offers for a solo handyman while online: socket `offer:new` / `offer:closed`, plus GET /pro/offers/current
 * every 5 s and on app focus. Syncs the server clock from `serverNow`, vibrates/plays the offers sound once per offer,
 * and accepts with a stable idempotency key per offer.
 */
export function useOfferQueue(enabled: boolean): OfferQueueApi {
  const client = useApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { t } = useT();
  const [queue, setQueue] = useState<OfferQueueState>(emptyOfferQueue);
  const [, setTick] = useState(0);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<OfferAcceptError | null>(null);
  // While the handyman tops up, the modal (an RN Modal above every screen) must not cover the balance screen.
  const [paused, setPaused] = useState(false);
  const keys = useRef(createAcceptKeyRegistry(newIdempotencyKey)).current;
  const seen = useRef(new Set<string>());
  // The live offer TTL (GET /config/public) tells live offers from scheduled pre-offers; read only while receiving.
  const config = useQuery({
    queryKey: qk.config,
    enabled,
    staleTime: 10 * 60_000,
    queryFn: () => client.call(api.health.config),
  });
  configureOfferTtl(config.data?.offerTtlSec);

  const poll = useQuery({
    queryKey: qk.offers,
    enabled,
    refetchInterval: enabled ? OFFER_POLL_MS : false,
    refetchOnWindowFocus: 'always',
    staleTime: 0,
    queryFn: async () => {
      const requestedAt = serverNow();
      const res = await client.call(api.pro.offers);
      clockStore.getState().syncWithServer(res.serverNow);
      return { ...res, requestedAt };
    },
  });

  useEffect(() => {
    if (poll.data) setQueue((s) => applyPoll(s, poll.data.items, poll.data.requestedAt));
  }, [poll.data]);

  useEffect(() => {
    if (enabled) return;
    setQueue((s) => ({ ...emptyOfferQueue(), dismissed: s.dismissed, alerted: s.alerted }));
    setError(null);
    setPaused(false);
  }, [enabled]);

  useSocketEvent('offer:new', (o) => {
    if (!enabled) return;
    if (!isLiveOffer(o)) {
      void queryClient.invalidateQueries({ queryKey: qk.scheduled });
      return;
    }
    setQueue((s) => addOffers(s, [o]));
  });
  useSocketEvent('offer:closed', (p) => {
    setQueue((s) => removeOffer(s, p.offerId));
    void clearOfferAlert(p.offerId);
    void queryClient.invalidateQueries({ queryKey: qk.scheduled });
  });

  // Re-render every second so expired offers leave the modal on time.
  const hasOffers = Object.keys(queue.offers).length > 0;
  useEffect(() => {
    if (!hasOffers) return;
    const id = setInterval(() => {
      setQueue((s) => pruneExpired(s, serverNow()));
      setTick((n) => n + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [hasOffers]);

  const current = useMemo(() => currentOffer(queue, serverNow()), [queue, queue.offers]);
  const offer = paused ? null : current.offer;
  const waiting = paused ? 0 : current.waiting;

  // Alert once per offer when it is shown; mark it seen on the server.
  const tRef = useRef(t);
  tRef.current = t;
  useEffect(() => {
    if (!offer) return;
    if (!markAlerted(queue, offer.id).isNew) return;
    // functional update: a socket offer or poll result queued since this render must not be overwritten
    setQueue((s) => markAlerted(s, offer.id).state);
    void playOfferAlert(offer.id, { title: tRef.current('offer.newTitle'), body: `${offer.category.name} · ${offer.address.area}` });
    if (!seen.current.has(offer.id)) {
      seen.current.add(offer.id);
      void client.call(api.pro.seenOffer, { params: { id: offer.id } }).catch(() => undefined);
    }
  }, [offer?.id]);

  const accept = useCallback(
    async (o: OfferView) => {
      if (accepting) return;
      setAccepting(true);
      setError(null);
      try {
        const res = await client.call(api.pro.acceptOffer, { params: { id: o.id }, idempotencyKey: keys.keyFor(o.id) });
        keys.forget(o.id);
        setQueue((s) => removeOffer(s, o.id, { dismiss: true }));
        void clearOfferAlert(o.id);
        void queryClient.invalidateQueries({ queryKey: ['pro'] });
        toast.show(t('offer.accepted'), { kind: 'success' });
        router.push(`/job/${res.assignment.id}` as never);
      } catch (err) {
        const code = errorCodeOf(err);
        if (code === 'INSUFFICIENT_BALANCE') {
          // shown inside the modal with the top-up action; the offer stays open
          setError({ offerId: o.id, code, message: t('offer.insufficientBalance') });
        } else if (GONE.has(code)) {
          // the offer leaves the modal: a toast (drawn inside the modal while the next offer is shown)
          keys.forget(o.id);
          setQueue((s) => removeOffer(s, o.id, { dismiss: true }));
          void clearOfferAlert(o.id);
          toast.show(code === 'OFFER_UNAVAILABLE' ? t('offer.taken') : errorMessage(t, err), { kind: 'error' });
        } else {
          // network/timeouts: keep the offer and the key so a retry cannot hold the fee twice
          setError({ offerId: o.id, code, message: errorMessage(t, err) });
        }
      } finally {
        setAccepting(false);
      }
    },
    [accepting, client, keys, queryClient, t, toast],
  );

  const decline = useCallback(
    async (o: OfferView) => {
      setQueue((s) => removeOffer(s, o.id, { dismiss: true }));
      setError((e) => (e?.offerId === o.id ? null : e));
      keys.forget(o.id);
      void clearOfferAlert(o.id);
      await client.call(api.pro.declineOffer, { params: { id: o.id } }).catch(() => undefined);
    },
    [client, keys],
  );

  const topUp = useCallback(() => {
    setError(null);
    setPaused(true);
    router.push('/balance' as never);
  }, []);

  const resume = useCallback(() => setPaused(false), []);

  const shownError = offer && error?.offerId === offer.id ? error : null;
  return { offer, waiting, accepting, error: shownError, accept, decline, topUp, resume };
}
