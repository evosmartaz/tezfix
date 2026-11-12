import React, { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router, useIsFocused, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { api, formatDate, formatMoney, formatPhone, type CustomerAssignment } from '@tezfiks/shared';
import {
  AppText,
  Banner,
  Button,
  Card,
  Countdown,
  ErrorState,
  Header,
  LoadingState,
  Screen,
  StatusPill,
  Timeline,
  colors,
  radii,
  spacing,
  useApi,
  useClockOffset,
  useT,
  useToast,
} from '@tezfiks/mobile';
import { ConfirmSheet } from '../../../components/ConfirmSheet';
import { ProviderCard } from '../../../components/ProviderCard';
import { TrackingMap } from '../../../components/TrackingMap';
import { qk, useAssignment, usePublicConfig, useRequest } from '../../../data/queries';
import { useAssignmentLive, useKeyRegistry } from '../../../hooks/useAssignmentLive';
import { assignmentStatusTone } from '../../../lib/orders';
import { requestErrorInfo } from '../../../lib/requestErrors';
import {
  contactState,
  declineSplit,
  etaLabelMinutes,
  freeCancelSecondsLeft,
  isActiveAssignment,
  penaltyCompensationOf,
  siblingAssignments,
  telUrl,
  trackingPhase,
  trackingSteps,
} from '../../../lib/tracking';

/** Safety net while a job runs (socket events are hints; REST is the truth). */
const ACTIVE_POLL_MS = 20_000;

type Sheet = 'cancel' | 'noShow' | 'decline' | null;

/**
 * Board 02 B5 tracking: route and live position, ETA "12 dəq məsafədə", provider card, Zəng et / Mesaj yaz locked until the
 * contact unlock, cancel with the penalty preview, no-show, decline on arrival, then the price (C1), tip, rating and guarantee.
 */
export default function AssignmentTrackingRoute() {
  const { t, locale } = useT();
  const client = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const keys = useKeyRegistry();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [polling, setPolling] = useState<number | false>(ACTIVE_POLL_MS);
  const q = useAssignment(id, { pollMs: polling });
  const a = q.data;
  const req = useRequest(a?.requestId);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [busy, setBusy] = useState(false);
  const prevStatus = useRef<string | null>(null);
  /** The price arrived while another screen (e.g. the chat) was on top: open the payment once tracking is visible again. */
  const payDue = useRef(false);
  const focused = useIsFocused();
  const clockOffset = useClockOffset();
  const config = usePublicConfig();

  useAssignmentLive(id, () => {
    void q.refetch();
    if (a) void queryClient.invalidateQueries({ queryKey: qk.request(a.requestId) });
  });

  useEffect(() => {
    if (!a) return;
    setPolling(isActiveAssignment(a.status) ? ACTIVE_POLL_MS : false);
    // The handyman proposed the price while the customer watches: open the payment screen (board 02 C1).
    if (prevStatus.current && prevStatus.current !== 'PRICE_PROPOSED' && a.status === 'PRICE_PROPOSED') payDue.current = true;
    if (a.status !== 'PRICE_PROPOSED') payDue.current = false;
    prevStatus.current = a.status;
    if (payDue.current && focused) {
      payDue.current = false;
      router.push(`/assignment/${a.id}/pay` as never);
    }
  }, [a?.status, a?.id, focused]);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/orders'));

  if (q.isPending) return <LoadingState testID="tracking-loading" />;
  if (q.isError || !a) {
    return (
      <Screen testID="tracking-screen">
        <Header onBack={back} />
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </Screen>
    );
  }

  const phase = trackingPhase(a.status);
  const contact = contactState(a);
  // Live ETA from acceptance: the server tracks the handyman before "Yola çıxdım" too (founder decision 2026-10-26).
  const eta = phase === 'accepted' || phase === 'enRoute' ? etaLabelMinutes(a.etaSec) : null;
  const siblings = siblingAssignments(req.data?.assignments ?? [], a.id);
  const target = req.data ? { lat: req.data.address.lat, lng: req.data.address.lng } : null;
  const showMap = phase === 'accepted' || phase === 'enRoute' || phase === 'arrived';

  const after = (updated: CustomerAssignment, message: string) => {
    queryClient.setQueryData(qk.assignment(updated.id), updated);
    void queryClient.invalidateQueries({ queryKey: qk.request(updated.requestId) });
    void queryClient.invalidateQueries({ queryKey: qk.requestsRoot });
    void queryClient.invalidateQueries({ queryKey: qk.account });
    void queryClient.invalidateQueries({ queryKey: qk.wallet });
    setSheet(null);
    toast.show(message, { kind: 'success' });
  };

  const act = async (kind: Exclude<Sheet, null>, reason: string) => {
    setBusy(true);
    try {
      const body = reason ? { reason } : {};
      let updated: CustomerAssignment;
      if (kind === 'cancel') {
        updated = await client.call(api.assignments.cancel, { params: { id: a.id }, body, idempotencyKey: keys.get('cancel') });
      } else if (kind === 'decline') {
        updated = await client.call(api.assignments.declineOnArrival, { params: { id: a.id }, body, idempotencyKey: keys.get('decline') });
      } else {
        updated = await client.call(api.assignments.reportNoShow, { params: { id: a.id }, idempotencyKey: keys.get('noShow') });
      }
      keys.settle(kind);
      after(updated, t(kind === 'cancel' ? 'tracking.cancelled' : kind === 'decline' ? 'tracking.declined' : 'tracking.noShowReported'));
    } catch (err) {
      keys.settle(kind, err);
      toast.show(t(requestErrorInfo(err).messageKey), { kind: 'error' });
      void q.refetch();
    } finally {
      setBusy(false);
    }
  };

  const call = () => {
    if (contact.canCall && a.providerPhone) void Linking.openURL(telUrl(a.providerPhone)).catch(() => undefined);
  };

  const freeLeft = freeCancelSecondsLeft(a, clockOffset);
  const decline = declineSplit(a.actions.declinePenalty, penaltyCompensationOf(config.data));

  return (
    <Screen scroll edges={['top', 'bottom']} refreshing={q.isRefetching} onRefresh={() => void q.refetch()} testID="tracking-screen">
      <Header
        onBack={back}
        title={t('tracking.title')}
        right={<StatusPill label={t(`common:assignmentStatus.${a.status}`)} tone={assignmentStatusTone(a.status)} testID="tracking-status" />}
      />

      {siblings.length ? (
        <View style={styles.block} testID="tracking-siblings">
          <AppText variant="caption" color="textMuted">
            {t('tracking.otherHandymen')}
          </AppText>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {siblings.map((s) => (
              <Pressable key={s.id} style={styles.chip} onPress={() => router.replace(`/assignment/${s.id}` as never)} testID={`tracking-sibling-${s.id}`}>
                <AppText variant="small">{`${s.provider.firstName} ${s.provider.lastName}`.trim()}</AppText>
                <AppText variant="caption" color="textMuted">
                  {t(`common:assignmentStatus.${s.status}`)}
                </AppText>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {showMap ? (
        <View style={styles.block}>
          <TrackingMap assignment={a} target={target} />
          {eta !== null ? (
            <View style={styles.eta} testID="tracking-eta">
              <AppText variant="small" color="textInverse">
                {t('tracking.etaAway', { minutes: eta })}
              </AppText>
            </View>
          ) : null}
        </View>
      ) : null}

      <Banner tone={phase === 'cancelled' ? 'neutral' : phase === 'disputed' ? 'warning' : 'success'} message={t(`tracking.phase.${phase}`)} testID="tracking-phase" />

      <Card style={styles.block}>
        <ProviderCard provider={a.provider} testID="tracking-provider" />
        <View style={styles.contactRow}>
          <Button
            variant="outline"
            size="sm"
            title={contact.canCall ? t('common:actions.call') : t('tracking.callLocked')}
            onPress={call}
            disabled={!contact.canCall}
            icon={<Ionicons name={contact.canCall ? 'call-outline' : 'lock-closed-outline'} size={16} color={contact.canCall ? colors.primary : colors.textMuted} />}
            style={styles.flex}
            testID="tracking-call"
          />
          <View style={styles.hgap} />
          <Button
            size="sm"
            title={t('common:actions.message')}
            onPress={() => router.push(`/assignment/${a.id}/chat` as never)}
            disabled={contact.locked}
            style={styles.flex}
            testID="tracking-chat"
          />
        </View>
        {contact.canCall && a.providerPhone ? (
          <AppText variant="bodyStrong" style={styles.line} testID="tracking-phone">
            {t('tracking.phone', { phone: formatPhone(a.providerPhone, 'international') })}
          </AppText>
        ) : null}
        {contact.locked && isActiveAssignment(a.status) ? (
          <AppText variant="caption" color="textMuted" style={styles.line} testID="tracking-locked-hint">
            {t('tracking.lockedHint')}
          </AppText>
        ) : null}
      </Card>

      {phase === 'price' ? (
        <Card style={styles.block} testID="tracking-price">
          <AppText variant="caption" color="textMuted">
            {t('pay.agreed')}
          </AppText>
          <AppText variant="h2">{a.price ? formatMoney(a.price.total, locale) : '—'}</AppText>
          <Button title={t('tracking.pay')} onPress={() => router.push(`/assignment/${a.id}/pay` as never)} style={styles.line} testID="tracking-pay" />
        </Card>
      ) : null}

      {phase === 'completed' ? (
        <Card style={styles.block} testID="tracking-completed">
          {a.price ? (
            <AppText variant="bodyStrong" testID="tracking-total">
              {t('tracking.total', { amount: formatMoney(a.price.total, locale) })}
            </AppText>
          ) : null}
          {a.paymentMethod ? (
            <AppText variant="small" color="textMuted">
              {t(a.paymentMethod === 'CARD' ? 'tracking.paidCard' : 'tracking.paidCash')}
            </AppText>
          ) : null}
          {a.tipAmount ? (
            <AppText variant="small" color="textMuted" testID="tracking-tipped">
              {t('tracking.tipped', { amount: formatMoney(a.tipAmount, locale) })}
            </AppText>
          ) : null}
          {a.guaranteeUntil ? (
            <AppText variant="small" color="primaryDark" testID="tracking-guarantee-until">
              {t('tracking.guaranteeUntil', { date: formatDate(a.guaranteeUntil) })}
            </AppText>
          ) : null}
          {a.actions.tip ? (
            <Button variant="accent" title={t('tracking.tip')} onPress={() => router.push(`/assignment/${a.id}/tip` as never)} style={styles.line} testID="tracking-tip" />
          ) : null}
          {a.actions.rate ? (
            <Button title={t('tracking.rate')} onPress={() => router.push(`/assignment/${a.id}/rate` as never)} style={styles.line} testID="tracking-rate" />
          ) : null}
          {a.actions.guaranteeClaim ? (
            <Button
              variant="outline"
              title={t('tracking.guarantee')}
              onPress={() => router.push(`/assignment/${a.id}/guarantee` as never)}
              style={styles.line}
              testID="tracking-guarantee"
            />
          ) : null}
        </Card>
      ) : null}

      <Card style={styles.block}>
        <Timeline
          steps={trackingSteps(a).map((s) => ({ key: s.key, label: t(`tracking.steps.${s.key}`), time: s.time, state: s.state }))}
          testID="tracking-timeline"
        />
      </Card>

      {a.actions.cancel && freeLeft > 0 ? (
        <View style={styles.freeRow} testID="tracking-free-cancel">
          <AppText variant="small" color="textMuted">
            {t('tracking.freeCancel')}
          </AppText>
          <Countdown deadline={a.freeCancelUntil} variant="bodyStrong" testID="tracking-free-countdown" onExpire={() => void q.refetch()} />
        </View>
      ) : null}
      {a.actions.reportNoShow ? (
        <Button variant="outline" title={t('tracking.noShow')} onPress={() => setSheet('noShow')} style={styles.line} testID="tracking-noshow" />
      ) : null}
      {a.actions.declineOnArrival ? (
        <Button variant="outline" title={t('tracking.decline')} onPress={() => setSheet('decline')} style={styles.line} testID="tracking-decline" />
      ) : null}
      {a.actions.cancel ? (
        <Button variant="ghost" title={t('tracking.cancel')} onPress={() => setSheet('cancel')} style={styles.line} testID="tracking-cancel" />
      ) : null}
      <Button variant="ghost" title={t('tracking.viewRequest')} onPress={() => router.push(`/request/${a.requestId}` as never)} testID="tracking-request" />

      <ConfirmSheet
        visible={sheet === 'cancel'}
        title={t('tracking.cancelTitle')}
        message={a.actions.cancelPenalty > 0 ? t('tracking.cancelPenalty', { amount: formatMoney(a.actions.cancelPenalty, locale) }) : t('tracking.cancelFree')}
        confirmLabel={t('tracking.cancelConfirm')}
        cancelLabel={t('tracking.goBack')}
        withReason
        loading={busy}
        onConfirm={(reason) => void act('cancel', reason)}
        onClose={() => setSheet(null)}
        testID="tracking-cancel-sheet"
      />
      <ConfirmSheet
        visible={sheet === 'decline'}
        title={t('tracking.declineTitle')}
        message={t('tracking.declineWarning', {
          amount: formatMoney(decline.amount, locale),
          comp: formatMoney(decline.comp, locale),
          fee: formatMoney(decline.fee, locale),
        })}
        confirmLabel={t('tracking.declineConfirm')}
        cancelLabel={t('tracking.goBack')}
        withReason
        loading={busy}
        onConfirm={(reason) => void act('decline', reason)}
        onClose={() => setSheet(null)}
        testID="tracking-decline-sheet"
      />
      <ConfirmSheet
        visible={sheet === 'noShow'}
        title={t('tracking.noShowTitle')}
        message={t('tracking.noShowText')}
        confirmLabel={t('tracking.noShowConfirm')}
        cancelLabel={t('tracking.goBack')}
        loading={busy}
        onConfirm={() => void act('noShow', '')}
        onClose={() => setSheet(null)}
        testID="tracking-noshow-sheet"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  block: { marginBottom: spacing.md },
  line: { marginTop: spacing.sm },
  hgap: { width: spacing.sm },
  contactRow: { flexDirection: 'row', marginTop: spacing.md },
  chips: { gap: spacing.sm, paddingVertical: spacing.xs },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radii.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  eta: {
    position: 'absolute',
    top: spacing.md,
    alignSelf: 'center',
    backgroundColor: colors.dark,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
  },
  freeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm },
});
