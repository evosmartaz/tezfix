'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Clock, MapPin, Star, X, Zap } from 'lucide-react';
import type { OfferView, ProAssignment, WalletSummary, WorkerLive } from '@tezfiks/shared';
import { DateTime } from '@/components/date-time';
import { PanelMap, BAKU_CENTER } from '@/components/map/panel-map';
import { Money } from '@/components/money';
import { EmptyState } from '@/components/states';
import { StatusBadge } from '@/components/status-badge';
import { toast } from '@/components/toaster';
import { Button } from '@/components/ui/button';
import type { ActionResult } from '@/lib/errors';
import { moneyText } from '@/lib/format';
import { useRealtime, useSocketEvent } from '@/lib/realtime/realtime-provider';
import { cn } from '@/lib/utils';
import {
  acceptOfferAction,
  activeAssignmentsAction,
  companyOffersAction,
  declineOfferAction,
  workersLiveAction,
} from '../actions';
import {
  BOARD_COLUMNS,
  acceptFeeTotal,
  canAccept,
  countdownText,
  defaultPicks,
  dispatchReducer,
  groupAssignments,
  initialDispatchState,
  isCompanyWalletEvent,
  isForCompany,
  pickLimit,
  prunePicks,
  remainingMs,
  remainingRatio,
  sortCandidates,
  togglePick,
  workerAvailability,
  workerCounts,
  workerMarkers,
  type DispatchState,
  type WorkerMapState,
  WORKER_MARKER_COLORS,
} from '../dispatch';
import type { CompanyLoadError as LoadErrorData } from '../load-types';
import { customerShortName, etaMinutes, personName, requestNo } from '../mappers';
import { Avatar, Note, WorkerPill, newKey, type WorkerPillState } from './ui';

/** Poll the offers this often even with a live socket (missed events, clock drift). */
export const OFFERS_POLL_MS = 10_000;
/** Worker positions refresh (also on `company:workers`). */
export const WORKERS_POLL_MS = 15_000;
export const ASSIGNMENTS_POLL_MS = 30_000;

export interface DispatchBoardProps {
  companyId: string;
  initialOffers: { items: OfferView[]; serverNow: string } | null;
  offersError?: LoadErrorData | null;
  initialAssignments: ProAssignment[] | null;
  assignmentsError?: LoadErrorData | null;
  initialWorkers: WorkerLive[] | null;
  workersError?: LoadErrorData | null;
  wallet: WalletSummary | null;
  center?: { lat: number; lng: number } | null;
}

async function unwrap<T>(p: Promise<ActionResult<T>>): Promise<T> {
  const r = await p;
  if (r.ok) return r.data;
  throw Object.assign(new Error(r.message), { code: r.code });
}

function errorCodeOf(err: unknown): string | null {
  return typeof err === 'object' && err !== null && 'code' in err ? String((err as { code: unknown }).code) : null;
}

/** Re-renders every second for countdowns. */
function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function DispatchBoard({
  companyId,
  initialOffers,
  offersError,
  initialAssignments,
  assignmentsError,
  initialWorkers,
  workersError,
  wallet: initialWallet,
  center,
}: DispatchBoardProps) {
  const t = useTranslations('panel.company.dispatch');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const { connected, connectionEpoch } = useRealtime();
  const [state, dispatch] = useReducer(dispatchReducer, undefined, () => initialDispatchState(companyId, initialOffers));
  const [offersFailed, setOffersFailed] = useState<string | null>(offersError ? (offersError.code === 'NOT_FOUND' ? null : offersError.message) : null);
  const [walletAvailable, setWalletAvailable] = useState<number | null>(initialWallet?.available ?? null);
  const router = useRouter();
  // A server re-render (after an accept, or without a socket) brings a fresh wallet.
  const serverAvailable = initialWallet?.available ?? null;
  useEffect(() => {
    if (serverAvailable !== null) setWalletAvailable(serverAvailable);
  }, [serverAvailable]);
  const now = useNow();

  // ----- offers: poll + socket + local expiry
  const polling = useRef(false);
  const poll = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    const requestedAt = Date.now();
    try {
      const r = await companyOffersAction(companyId);
      if (r.ok) {
        dispatch({ type: 'sync', items: r.data.items, serverNow: r.data.serverNow, requestedAt, receivedAt: Date.now() });
        setOffersFailed(null);
      } else {
        setOffersFailed(r.message);
      }
    } finally {
      polling.current = false;
    }
  }, [companyId]);

  useEffect(() => {
    const id = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') void poll();
    }, OFFERS_POLL_MS);
    return () => clearInterval(id);
  }, [poll]);

  // Refetch everything after a reconnect (events may have been missed); not on the first connect.
  const seenEpoch = useRef(connectionEpoch);
  useEffect(() => {
    if (connectionEpoch > 1 && connectionEpoch !== seenEpoch.current) {
      void poll();
      void queryClient.invalidateQueries({ queryKey: ['company', companyId] });
    }
    seenEpoch.current = connectionEpoch;
  }, [connectionEpoch, poll, queryClient, companyId]);

  useEffect(() => {
    dispatch({ type: 'tick', now });
  }, [now]);

  useSocketEvent('offer:new', (o) => {
    if (isForCompany(o, companyId)) dispatch({ type: 'add', offer: o, now: Date.now() });
  });
  useSocketEvent('offer:closed', (p) => {
    dispatch({ type: 'close', offerId: p.offerId, reason: p.reason, now: Date.now() });
  });
  useSocketEvent('assignment:updated', () => {
    void queryClient.invalidateQueries({ queryKey: ['company', companyId, 'activeAssignments'] });
    void queryClient.invalidateQueries({ queryKey: ['company', companyId, 'workersLive'] });
  });
  useSocketEvent('company:workers', (p) => {
    if (isForCompany(p, companyId)) void queryClient.invalidateQueries({ queryKey: ['company', companyId, 'workersLive'] });
  });
  useSocketEvent('wallet:updated', (p) => {
    if (isCompanyWalletEvent(p, companyId)) setWalletAvailable(p.available);
  });

  // ----- notices of offers that disappeared (taken elsewhere, expired, cancelled)
  const shown = useRef(new Set<string>());
  useEffect(() => {
    for (const n of state.notices) {
      if (shown.current.has(n.offerId)) continue;
      shown.current.add(n.offerId);
      toast(t(`notice.${n.reason}`, { number: requestNo(n.requestNumber) }));
      dispatch({ type: 'dismissNotice', offerId: n.offerId });
    }
  }, [state.notices, t]);

  // ----- active jobs and worker positions
  const assignments = useQuery({
    queryKey: ['company', companyId, 'activeAssignments'],
    queryFn: async () => (await unwrap(activeAssignmentsAction(companyId))).items,
    initialData: initialAssignments ?? undefined,
    staleTime: initialAssignments ? 10_000 : undefined,
    refetchInterval: ASSIGNMENTS_POLL_MS,
    enabled: !(assignmentsError?.code === 'NOT_FOUND'),
  });
  const workers = useQuery({
    queryKey: ['company', companyId, 'workersLive'],
    queryFn: async () => (await unwrap(workersLiveAction(companyId))).items,
    initialData: initialWorkers ?? undefined,
    staleTime: initialWorkers ? 5_000 : undefined,
    refetchInterval: WORKERS_POLL_MS,
    enabled: !(workersError?.code === 'NOT_FOUND'),
  });

  function onAccepted(offer: OfferView, count: number) {
    dispatch({ type: 'accepted', offerId: offer.id, now: Date.now() });
    toast.success(t('offers.accepted', { number: requestNo(offer.requestNumber), count }));
    void queryClient.invalidateQueries({ queryKey: ['company', companyId] });
    // The fee hold changed the wallet: re-render the server data (wallet chip) even without a live socket.
    router.refresh();
  }

  function onGone(offer: OfferView) {
    dispatch({ type: 'close', offerId: offer.id, reason: 'TAKEN', now: Date.now() });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold',
            connected ? 'bg-primary/10 text-primary-strong' : 'bg-muted text-muted-foreground',
          )}
          data-connected={connected || undefined}
        >
          <span className={cn('size-2 rounded-full', connected ? 'bg-primary' : 'bg-muted-foreground')} />
          {connected ? t('live') : t('polling')}
        </span>
        {walletAvailable !== null ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-ink px-3 py-1 text-xs font-semibold text-white" data-testid="wallet-chip">
            {t('walletChip', { amount: moneyText(walletAvailable, locale, { compact: true }) })}
          </span>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        <section className="flex flex-col gap-3 xl:col-span-2" aria-labelledby="offers-title">
          <h2 id="offers-title" className="text-base font-semibold">
            {t('offers.title')} {state.offers.length ? <span className="text-muted-foreground">({state.offers.length})</span> : null}
          </h2>
          {offersError?.code === 'NOT_FOUND' ? <Note tone="info">{t('offers.unavailable')}</Note> : null}
          {offersFailed ? <Note tone="danger">{offersFailed}</Note> : null}
          {state.offers.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-surface">
              <EmptyState title={t('offers.empty')} description={t('offers.emptyHint')} />
            </div>
          ) : (
            state.offers.map((o) => (
              <OfferCard
                key={o.id}
                companyId={companyId}
                offer={o}
                state={state}
                now={now}
                walletAvailable={walletAvailable}
                onAccepted={onAccepted}
                onDeclined={() => dispatch({ type: 'declined', offerId: o.id, now: Date.now() })}
                onGone={() => onGone(o)}
                onRefresh={() => void poll()}
              />
            ))
          )}
        </section>

        <section className="flex flex-col gap-3 xl:col-span-3" aria-labelledby="map-title">
          <h2 id="map-title" className="text-base font-semibold">
            {t('map.title')}
          </h2>
          <WorkersMap workers={workers.data ?? []} error={workersError} failed={workers.isError} center={center} />
        </section>
      </div>

      <section className="flex flex-col gap-3" aria-labelledby="board-title">
        <h2 id="board-title" className="text-base font-semibold">
          {t('board.title')}
        </h2>
        {assignmentsError?.code === 'NOT_FOUND' ? (
          <Note tone="info">{t('board.unavailable')}</Note>
        ) : assignments.isError ? (
          <Note tone="danger">{assignments.error instanceof Error ? assignments.error.message : t('board.error')}</Note>
        ) : (
          <JobsBoard companyId={companyId} items={assignments.data ?? []} now={now} />
        )}
      </section>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ offer card ---

function pillState(w: { busy: boolean; hasTrade: boolean; online: boolean }): WorkerPillState {
  const a = workerAvailability(w);
  if (a.block === 'BUSY') return 'busy';
  if (a.block === 'NO_TRADE') return 'noTrade';
  return a.offline ? 'offline' : 'free';
}

function distanceText(m: number | null, locale: string): string | null {
  if (m === null) return null;
  const km = m / 1000;
  const text = km < 10 ? km.toFixed(1) : String(Math.round(km));
  return `${locale === 'en' ? text : text.replace('.', ',')} km`;
}

export function OfferCard({
  companyId,
  offer,
  state,
  now,
  walletAvailable,
  onAccepted,
  onDeclined,
  onGone,
  onRefresh,
}: {
  companyId: string;
  offer: OfferView;
  state: Pick<DispatchState, 'clockOffsetMs'>;
  now: number;
  walletAvailable: number | null;
  onAccepted: (offer: OfferView, count: number) => void;
  onDeclined: () => void;
  onGone: () => void;
  onRefresh: () => void;
}) {
  const t = useTranslations('panel.company.dispatch.offers');
  const tc = useTranslations('common');
  const locale = useLocale();
  const [selected, setSelected] = useState<string[]>(() => defaultPicks(offer));
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const keys = useRef(new Map<string, string>());

  // Picks that became invalid after an update of the offer (worker now busy, fewer open slots) are dropped.
  useEffect(() => {
    setSelected((prev) => {
      const next = prunePicks(prev, offer);
      return next.length === prev.length ? prev : next;
    });
  }, [offer]);

  const left = remainingMs(offer, state, now);
  const ratio = remainingRatio(offer, state, now);
  const limit = pickLimit(offer);
  const fee = acceptFeeTotal(offer, Math.max(1, selected.length));
  const short = walletAvailable !== null && selected.length > 0 && walletAvailable < acceptFeeTotal(offer, selected.length);
  const workers = useMemo(() => sortCandidates(offer.candidateWorkers), [offer.candidateWorkers]);

  function pick(id: string) {
    const r = togglePick(selected, id, offer);
    setSelected(r.selected);
    setError(r.error === 'LIMIT' ? t('limit', { count: limit }) : r.error === 'UNAVAILABLE' ? t('unavailableWorker') : null);
  }

  async function accept() {
    if (!canAccept(selected, offer)) return;
    const sig = `${offer.id}:${[...selected].sort().join(',')}`;
    let key = keys.current.get(sig);
    if (!key) {
      key = newKey('accept');
      keys.current.set(sig, key);
    }
    setBusy('accept');
    setError(null);
    try {
      const r = await acceptOfferAction(companyId, offer.id, selected, key);
      if (r.ok) {
        onAccepted(offer, r.data.assignments.length);
        return;
      }
      if (r.code === 'OFFER_UNAVAILABLE' || r.code === 'OFFER_EXPIRED' || r.code === 'NOT_FOUND') {
        toast.error(r.message);
        onGone();
        return;
      }
      // Validation and availability errors are final for this key; a network failure keeps it for the retry.
      if (r.code !== 'NETWORK' && r.code !== 'TIMEOUT' && r.code !== 'INTERNAL') keys.current.delete(sig);
      setError(r.message);
      if (r.code === 'WORKER_UNAVAILABLE' || r.code === 'VALIDATION_FAILED') onRefresh();
    } finally {
      setBusy(null);
    }
  }

  async function decline() {
    setBusy('decline');
    try {
      const r = await declineOfferAction(companyId, offer.id);
      if (r.ok || r.code === 'OFFER_UNAVAILABLE' || r.code === 'NOT_FOUND') {
        onDeclined();
        if (r.ok) toast(t('declined', { number: requestNo(offer.requestNumber) }));
      } else {
        setError(r.message);
      }
    } finally {
      setBusy(null);
    }
  }

  const customerName = customerShortName(offer.customer);

  return (
    <article
      className="flex flex-col gap-4 rounded-lg border-2 border-primary bg-surface p-4 shadow-xs"
      data-testid="offer-card"
      data-offer-id={offer.id}
      aria-label={t('newOrder', { number: requestNo(offer.requestNumber) })}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-2 text-lg font-bold">
            {t('newOrder', { number: requestNo(offer.requestNumber) })}
            {offer.isEmergency ? (
              <span className="inline-flex items-center gap-1 rounded bg-danger px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-white uppercase">
                <Zap className="size-3" aria-hidden />
                {t('emergency')}
              </span>
            ) : null}
            {offer.isGuaranteeFix ? (
              <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-violet-700 uppercase">
                {t('guarantee')}
              </span>
            ) : null}
          </h3>
          <p className="text-sm text-muted-foreground">
            {offer.category.name} — {offer.descriptionShort}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1" aria-live="polite">
          <span
            className={cn(
              'inline-flex items-center gap-1 font-mono text-lg font-bold tabular-nums',
              left <= 10_000 ? 'text-danger' : 'text-foreground',
            )}
            data-testid="countdown"
            title={t('expiresIn')}
          >
            <Clock className="size-4" aria-hidden />
            {countdownText(left)}
          </span>
        </div>
      </header>
      <div className="h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className={cn('h-full', left <= 10_000 ? 'bg-danger' : 'bg-primary')} style={{ width: `${Math.round(ratio * 100)}%` }} />
      </div>

      <dl className="grid grid-cols-1 gap-1 text-sm text-muted-foreground sm:grid-cols-2">
        <div className="flex items-center gap-1.5">
          <MapPin className="size-4 shrink-0" aria-hidden />
          <span className="truncate">{offer.address.area}</span>
        </div>
        <div>
          {offer.timing === 'SCHEDULED' && offer.scheduledAt ? (
            <>
              {t('scheduled')} <DateTime value={offer.scheduledAt} />
            </>
          ) : (
            tc(`timing.${offer.timing}`)
          )}
          {distanceText(offer.distanceM, locale) ? ` · ${distanceText(offer.distanceM, locale)}` : ''}
          {offer.etaMin !== null ? ` · ${t('eta', { minutes: offer.etaMin })}` : ''}
        </div>
        <div className="flex items-center gap-1.5">
          {t('customer', { name: customerName })}
          {offer.customer.ratingAvg !== null ? (
            <span className="inline-flex items-center gap-0.5">
              <Star className="size-3.5 fill-accent text-accent" aria-hidden />
              {offer.customer.ratingAvg.toFixed(1)}
            </span>
          ) : null}
        </div>
        <div>{t('slots', { value: offer.slotsOpen, requested: offer.slotsRequested })}</div>
      </dl>

      <Note>{t('feeNote', { amount: moneyText(fee, locale, { compact: true }) })}</Note>
      {short ? (
        <Note tone="danger">
          <AlertTriangle className="mr-1 inline size-4" aria-hidden />
          {t('lowBalance')}{' '}
          <Link href={`/company/${companyId}/balance`} className="font-semibold underline">
            {t('topUp')}
          </Link>
        </Note>
      ) : null}

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <h4 className="text-sm font-semibold">{t('pickTitle')}</h4>
          <span className="text-xs text-muted-foreground">{t('pickHint', { count: limit })}</span>
        </div>
        {workers.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noCandidates')}</p>
        ) : (
          <ul className="flex flex-col gap-2" role="listbox" aria-multiselectable={limit > 1} aria-label={t('pickTitle')}>
            {workers.map((w) => {
              const a = workerAvailability(w);
              const isSel = selected.includes(w.handymanId);
              const name = personName(w);
              return (
                <li key={w.handymanId}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSel}
                    aria-disabled={!a.selectable || undefined}
                    disabled={!a.selectable || busy !== null}
                    onClick={() => pick(w.handymanId)}
                    data-worker-id={w.handymanId}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                      isSel ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border hover:border-primary/60',
                      !a.selectable && 'cursor-not-allowed opacity-60 hover:border-border',
                    )}
                  >
                    <Avatar name={name} photo={w.photo} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {offer.category.name}
                        {w.ratingAvg !== null ? ` • ★ ${w.ratingAvg.toFixed(1)}` : ''}
                        {distanceText(w.distanceM, locale) ? ` • ${distanceText(w.distanceM, locale)}` : ''}
                      </span>
                    </span>
                    {isSel ? <Check className="size-4 text-primary" aria-hidden /> : null}
                    <WorkerPill state={pillState(w)} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" onClick={decline} loading={busy === 'decline'} disabled={busy !== null}>
          <X aria-hidden />
          {t('decline')}
        </Button>
        <Button onClick={accept} loading={busy === 'accept'} disabled={busy !== null || !canAccept(selected, offer)}>
          <Check aria-hidden />
          {t('accept')}
        </Button>
      </div>
    </article>
  );
}

// ------------------------------------------------------------------------------------------------ jobs board ---

export function JobsBoard({ companyId, items, now }: { companyId: string; items: ProAssignment[]; now: number }) {
  const t = useTranslations('panel.company.dispatch.board');
  const groups = useMemo(() => groupAssignments(items), [items]);
  const total = BOARD_COLUMNS.reduce((n, c) => n + groups[c].length, 0);
  if (total === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-surface">
        <EmptyState title={t('empty')} />
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
      {BOARD_COLUMNS.map((col) => (
        <div key={col} className="flex flex-col gap-2 rounded-lg bg-muted/60 p-3" data-column={col}>
          <h3 className="flex items-center justify-between text-sm font-semibold">
            {t(`columns.${col}`)}
            <span className="rounded-full bg-surface px-2 text-xs text-muted-foreground">{groups[col].length}</span>
          </h3>
          {groups[col].map((a) => (
            <Link
              key={a.id}
              href={`/company/${companyId}/orders/${a.id}`}
              className="flex flex-col gap-1 rounded-md border border-border bg-surface p-3 text-sm shadow-xs hover:border-primary"
              data-assignment-id={a.id}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-semibold">{requestNo(a.requestNumber)}</span>
                <StatusBadge family="assignmentStatus" status={a.status} />
              </span>
              <span className="text-muted-foreground">{a.category.name}</span>
              <span className="font-medium">{personName(a.worker)}</span>
              <span className="truncate text-xs text-muted-foreground">{a.address.district ?? a.address.formatted}</span>
              {a.status === 'EN_ROUTE' && etaMinutes(a.etaSec) !== null ? (
                <span className="text-xs font-semibold text-primary-strong">{t('eta', { minutes: etaMinutes(a.etaSec)! })}</span>
              ) : null}
              {a.status === 'ACCEPTED' && a.timing === 'SCHEDULED' && a.scheduledAt ? (
                <span className="text-xs text-muted-foreground">
                  {t('scheduledFor')} <DateTime value={a.scheduledAt} />
                </span>
              ) : null}
              {a.status === 'ACCEPTED' && Date.parse(a.freeCancelUntil) > now ? (
                <span className="text-xs text-muted-foreground">{t('freeCancel', { value: countdownText(Date.parse(a.freeCancelUntil) - now) })}</span>
              ) : null}
              {a.price ? (
                <span className="text-xs">
                  {t('price')} <Money minor={a.price.total} />
                </span>
              ) : null}
            </Link>
          ))}
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ worker map ---

export function WorkersMap({
  workers,
  error,
  failed,
  center,
}: {
  workers: WorkerLive[];
  error?: LoadErrorData | null;
  failed?: boolean;
  center?: { lat: number; lng: number } | null;
}) {
  const t = useTranslations('panel.company.dispatch.map');
  const tw = useTranslations('panel.company.workerState');
  const markers = useMemo(
    () =>
      workerMarkers(workers, (w) =>
        `${personName(w)} · ${w.busy ? tw('busy') : w.isOnline ? tw('free') : tw('offline')}`,
      ),
    [workers, tw],
  );
  // Centre once (company base, else the first known worker, else Baku); live updates only move the markers.
  const [mapCenter] = useState(() =>
    center ? { lat: center.lat, lng: center.lng } : markers[0] ? { lat: markers[0].lat, lng: markers[0].lng } : BAKU_CENTER,
  );
  const counts = workerCounts(workers);
  const legend: Array<[WorkerMapState, string]> = [
    ['online', tw('free')],
    ['busy', tw('busy')],
    ['offline', tw('offline')],
  ];
  return (
    <div className="flex flex-col gap-2">
      {error?.code === 'NOT_FOUND' ? <Note tone="info">{t('unavailable')}</Note> : null}
      {error && error.code !== 'NOT_FOUND' ? <Note tone="danger">{error.message}</Note> : null}
      {failed ? <Note tone="danger">{t('error')}</Note> : null}
      <PanelMap className="h-[420px]" center={mapCenter} markers={markers} />
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground" data-testid="map-legend">
        {legend.map(([s, label]) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-full" style={{ background: WORKER_MARKER_COLORS[s] }} />
            {label}: {counts[s]}
          </span>
        ))}
        {workers.length > 0 && markers.length < workers.length ? <span>{t('noPosition', { count: workers.length - markers.length })}</span> : null}
      </div>
    </div>
  );
}
