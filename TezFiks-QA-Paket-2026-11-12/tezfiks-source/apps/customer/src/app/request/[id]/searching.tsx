import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { api, formatMoney, type CustomerAssignment, type RequestDetail } from '@tezfiks/shared';
import {
  AppText,
  Avatar,
  BottomSheet,
  Button,
  Countdown,
  ErrorState,
  LoadingState,
  Screen,
  colors,
  spacing,
  useApi,
  useSocket,
  useSocketConnected,
  useSocketEvent,
  useT,
  useToast,
} from '@tezfiks/mobile';
import { SearchHexMap } from '../../../components/SearchHexMap';
import { qk, useRequest } from '../../../data/queries';
import { groupByRing, mergeCells, requestCell } from '../../../lib/hexagons';
import { isPartlyFilledSearch, liveAssignmentId, reachKmForRing, staysOnSearchScreen } from '../../../lib/orders';
import { requestErrorInfo } from '../../../lib/requestErrors';

/** Poll as a safety net while searching (socket events are hints; REST is the truth). */
const SEARCH_POLL_MS = 10_000;

/**
 * Board 02 B4 "Yaxınlıqdakı ustalar axtarılır...": light screen (UX-C19), pulsing H3 rings from `request:search`, countdown to the
 * end of the search and cancel. A multi-handyman request becomes ASSIGNED with the first acceptance while the open slots
 * are still dispatched (spec 6.1): the screen then keeps the live search, lists the handymen found so far and links to the
 * order. When the handyman of a single-handyman request accepts, it moves straight to their live tracking (B5); otherwise to
 * the request detail once the search is over (all slots filled, search ended) or the request is cancelled.
 */
export default function SearchingRoute() {
  const { t, locale } = useT();
  const client = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const req = useRequest(id, { pollMs: SEARCH_POLL_MS });
  const [cells, setCells] = useState<string[]>([]);
  const [endsAt, setEndsAt] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const socket = useSocket();
  const connected = useSocketConnected();
  const r = req.data;

  useEffect(() => {
    if (!r?.search) return;
    setCells((prev) => mergeCells(prev, r.search?.cells ?? []));
    setEndsAt(r.search.endsAt);
  }, [r?.search]);

  useSocketEvent('request:search', (p) => {
    if (p.requestId !== id) return;
    setCells((prev) => mergeCells(prev, p.cells));
    setEndsAt(p.endsAt);
  });
  useSocketEvent('request:updated', (p) => {
    if (p.requestId === id) void req.refetch();
  });
  useSocketEvent('assignment:updated', (p) => {
    if (p.requestId === id) void req.refetch();
  });

  // The request room also carries search progress; the user room alone is enough, so a failed join is harmless.
  useEffect(() => {
    if (!socket || !connected || !id) return;
    socket.emit('room:join', { room: 'request', id });
    return () => {
      socket.emit('room:leave', { room: 'request', id });
    };
  }, [socket, connected, id]);

  useEffect(() => {
    if (!r || staysOnSearchScreen(r)) return;
    // Spec customer flow B4 → B5: the handyman accepted a single-handyman request → their live tracking (map, ETA).
    const live = r.slotsRequested === 1 ? liveAssignmentId(r) : null;
    router.replace((live ? `/assignment/${live}` : `/request/${r.id}`) as never);
  }, [r?.status, r?.isSearching, r?.id]);

  const centerCell = useMemo(() => (r ? requestCell(r.address.lat, r.address.lng) : null), [r?.address.lat, r?.address.lng]);
  const rings = useMemo(() => groupByRing(cells, centerCell), [cells, centerCell]);
  const newestRing = rings.length ? rings[rings.length - 1].ring : 0;

  const cancel = async () => {
    if (!r) return;
    setCancelling(true);
    try {
      const updated = await client.call(api.requests.cancel, { params: { id: r.id }, body: {} });
      queryClient.setQueryData(qk.request(r.id), updated);
      void queryClient.invalidateQueries({ queryKey: qk.requestsRoot });
      setConfirm(false);
      router.replace(`/request/${r.id}` as never);
    } catch (err) {
      toast.show(t(requestErrorInfo(err).messageKey), { kind: 'error' });
      void req.refetch();
    } finally {
      setCancelling(false);
    }
  };

  if (req.isPending) return <LoadingState testID="searching-loading" />;
  if (req.isError || !r) {
    return (
      <Screen testID="searching-screen">
        <ErrorState error={req.error} onRetry={() => void req.refetch()} />
      </Screen>
    );
  }

  if (r.status === 'EXPIRED') return <NoMatch request={r} />;

  const partly = isPartlyFilledSearch(r);
  const byId = new Map(r.assignments.map((a) => [a.id, a]));
  const found = r.slots
    .map((s) => (s.status === 'FILLED' && s.assignmentId ? byId.get(s.assignmentId) : undefined))
    .filter((a): a is CustomerAssignment => !!a);

  return (
    <Screen scroll padded={false} testID="searching-screen">
      <View style={styles.mapBox}>
        <SearchHexMap cells={cells} center={{ lat: r.address.lat, lng: r.address.lng }} centerCell={centerCell} />
      </View>
      <View style={styles.body}>
        <PulseDot />
        <AppText variant="h2" color="text" align="center" style={styles.title}>
          {t(partly ? 'searching.partialTitle' : 'searching.title')}
        </AppText>
        <AppText variant="small" color="textMuted" align="center" testID="searching-reach">
          {t('searching.reach', { km: String(reachKmForRing(newestRing)).replace('.', locale === 'en' ? '.' : ',') })}
        </AppText>
        {r.slotsRequested > 1 ? (
          <AppText variant="small" color="text" align="center" style={styles.line} testID="searching-slots">
            {t('orders.slotsFilled', { filled: r.slotsFilled, total: r.slotsRequested })}
          </AppText>
        ) : null}
        {found.length ? (
          <View style={styles.found} testID="searching-found">
            <AppText variant="caption" color="textMuted">
              {t('searching.found')}
            </AppText>
            {found.map((a) => (
              <FoundProvider key={a.id} a={a} />
            ))}
          </View>
        ) : null}
        {endsAt ? (
          <View style={styles.countdown}>
            <AppText variant="caption" color="textMuted">
              {t('searching.endsIn')}
            </AppText>
            <Countdown deadline={endsAt} color="text" variant="bodyStrong" testID="searching-countdown" />
          </View>
        ) : null}
        {r.emergencyFee ? (
          <AppText variant="caption" color="textMuted" align="center" style={styles.line}>
            {t('searching.emergencyHeld', { amount: formatMoney(r.emergencyFee.total, locale) })}
          </AppText>
        ) : null}
        {partly ? (
          <Button
            title={t('searching.viewOrder')}
            onPress={() => router.dismissTo(`/request/${r.id}` as never)}
            style={styles.cancel}
            testID="searching-view-order"
          />
        ) : null}
        <Button
          variant="outline"
          title={t('searching.cancel')}
          onPress={() => setConfirm(true)}
          disabled={!r.canCancel}
          style={styles.cancel}
          testID="searching-cancel"
        />
      </View>
      <BottomSheet visible={confirm} onClose={() => setConfirm(false)} title={t('searching.cancelTitle')} testID="searching-cancel-sheet">
        <AppText variant="body" style={styles.line}>
          {r.cancelPenaltyPreview > 0
            ? t('searching.cancelPenalty', { amount: formatMoney(r.cancelPenaltyPreview, locale) })
            : t('searching.cancelFree')}
        </AppText>
        <Button variant="danger" title={t('searching.cancelConfirm')} onPress={() => void cancel()} loading={cancelling} testID="searching-cancel-confirm" />
        <View style={styles.gap} />
        <Button variant="outline" title={t('searching.keepSearching')} onPress={() => setConfirm(false)} testID="searching-cancel-keep" />
      </BottomSheet>
    </Screen>
  );
}

/** A handyman who already accepted one of the slots (no phone before contact unlock). */
function FoundProvider({ a }: { a: CustomerAssignment }) {
  const { t } = useT();
  const p = a.provider;
  return (
    <Pressable
      style={styles.foundRow}
      onPress={() => router.push(`/assignment/${a.id}` as never)}
      accessibilityRole="button"
      accessibilityHint={t('detail.track')}
      testID={`searching-found-${a.id}`}
    >
      <Avatar uri={p.photo?.url} firstName={p.firstName} lastName={p.lastName} size={36} />
      <View style={styles.foundText}>
        <AppText variant="bodyStrong" color="text">
          {`${p.firstName} ${p.lastName}`.trim()}
        </AppText>
        <View style={styles.foundMeta}>
          <AppText variant="caption" color="textMuted">
            {p.ratingAvg !== null ? `★ ${p.ratingAvg.toFixed(1)} · ` : ''}
            {t('detail.jobs', { count: p.completedCount })}
          </AppText>
        </View>
      </View>
    </Pressable>
  );
}

/** Search ended without a handyman (request EXPIRED). */
function NoMatch({ request }: { request: RequestDetail }) {
  const { t } = useT();
  return (
    <Screen testID="searching-expired">
      <View style={styles.expired}>
        <AppText variant="h2" color="text" align="center">
          {t('searching.expiredTitle')}
        </AppText>
        <AppText variant="body" color="textMuted" align="center" style={styles.line}>
          {t('searching.expiredMessage')}
        </AppText>
        <Button
          title={t('searching.repeat')}
          onPress={() => router.replace({ pathname: '/request/new', params: { repeatId: request.id } })}
          style={styles.cancel}
          testID="searching-repeat"
        />
        <Button variant="ghost" title={t('searching.toOrders')} onPress={() => router.replace('/orders')} testID="searching-to-orders" />
      </View>
    </Screen>
  );
}

/** Concentric pulse of board B4 (native-driver opacity/scale loop). */
function PulseDot() {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(v, { toValue: 1, duration: 1600, easing: Easing.out(Easing.ease), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [v]);
  const scale = v.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.6] });
  const opacity = v.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] });
  return (
    <View style={styles.pulseBox} testID="searching-pulse">
      <View style={styles.pulseHalo} />
      <Animated.View style={[styles.pulseRing, { transform: [{ scale }], opacity }]} />
      <View style={styles.pulseCore}>
        <Ionicons name="radio-outline" size={30} color={colors.textInverse} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  mapBox: { height: 280, margin: spacing.lg, borderRadius: 20, overflow: 'hidden' },
  body: { flex: 1, alignItems: 'center', paddingHorizontal: spacing.xl },
  title: { marginTop: spacing.md, marginBottom: spacing.sm },
  line: { marginTop: spacing.sm, marginBottom: spacing.sm },
  countdown: { alignItems: 'center', marginTop: spacing.md },
  cancel: { marginTop: spacing.xl, alignSelf: 'stretch' },
  gap: { height: spacing.sm },
  found: { alignSelf: 'stretch', marginTop: spacing.md },
  foundRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm },
  foundText: { flex: 1, marginLeft: spacing.sm },
  foundMeta: { flexDirection: 'row', alignItems: 'center' },
  expired: { flex: 1, justifyContent: 'center' },
  pulseBox: { width: 132, height: 132, alignItems: 'center', justifyContent: 'center' },
  pulseHalo: { position: 'absolute', width: 132, height: 132, borderRadius: 66, backgroundColor: colors.primarySoft },
  pulseRing: { position: 'absolute', width: 96, height: 96, borderRadius: 48, backgroundColor: colors.primaryHalo },
  pulseCore: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
});
