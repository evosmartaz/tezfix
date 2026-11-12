import React, { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  api,
  formatDateTime,
  formatMoney,
  formatRequestNumber,
  type CustomerAssignment,
  type RequestDetail,
} from '@tezfiks/shared';
import {
  AppText,
  Avatar,
  Banner,
  BottomSheet,
  Button,
  Card,
  ErrorState,
  Header,
  LoadingState,
  Screen,
  StatusPill,
  Stars,
  colors,
  spacing,
  useApi,
  useT,
  useToast,
} from '@tezfiks/mobile';
import { CategoryIcon } from '../../../components/CategoryIcon';
import { qk, useRequest } from '../../../data/queries';
import { addressDetails } from '../../../lib/address';
import { assignmentStatusTone, requestStatusTone, showsSearchLink, slotStatusTone } from '../../../lib/orders';
import { requestErrorInfo } from '../../../lib/requestErrors';

/** Orders detail: status, service, timing, address, description, photos, slots with their assignments, cancel. */
export default function RequestDetailRoute() {
  const { t, locale } = useT();
  const client = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const req = useRequest(id);
  const [confirm, setConfirm] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const back = () => (router.canGoBack() ? router.back() : router.replace('/orders'));

  if (req.isPending) return <LoadingState testID="request-loading" />;
  if (req.isError || !req.data) {
    return (
      <Screen testID="request-detail-screen">
        <Header onBack={back} />
        <ErrorState error={req.error} onRetry={() => void req.refetch()} />
      </Screen>
    );
  }
  const r = req.data;

  const cancel = async () => {
    setCancelling(true);
    try {
      const updated = await client.call(api.requests.cancel, { params: { id: r.id }, body: {} });
      queryClient.setQueryData(qk.request(r.id), updated);
      void queryClient.invalidateQueries({ queryKey: qk.requestsRoot });
      void queryClient.invalidateQueries({ queryKey: qk.account });
      setConfirm(false);
      toast.show(t('detail.cancelled'), { kind: 'success' });
    } catch (err) {
      toast.show(t(requestErrorInfo(err).messageKey), { kind: 'error' });
      void req.refetch();
    } finally {
      setCancelling(false);
    }
  };

  const details = addressDetails(r.address, t);
  const byId = new Map(r.assignments.map((a) => [a.id, a]));

  return (
    <Screen scroll edges={['top', 'bottom']} refreshing={req.isRefetching} onRefresh={() => void req.refetch()} testID="request-detail-screen">
      <Header
        onBack={back}
        title={formatRequestNumber(r.number)}
        right={<StatusPill label={t(`common:requestStatus.${r.status}`)} tone={requestStatusTone(r.status)} testID="detail-status" />}
      />

      {showsSearchLink(r) ? (
        <Card dark onPress={() => router.push(`/request/${r.id}/searching` as never)} style={styles.block} testID="detail-searching">
          <AppText variant="bodyStrong" color="textInverse">
            {t('detail.searchingNow')}
          </AppText>
          <AppText variant="caption" color="textInverseMuted">
            {t('detail.openSearch')}
          </AppText>
        </Card>
      ) : null}
      {r.timing === 'SCHEDULED' && r.status === 'SEARCHING' ? (
        <Banner tone="info" message={t('detail.scheduledWaiting')} testID="detail-scheduled" />
      ) : null}
      {r.status === 'EXPIRED' ? (
        <View style={styles.block} testID="detail-expired">
          <Banner tone="danger" message={t('searching.expiredMessage')} />
          <Button title={t('searching.repeat')} onPress={() => router.push({ pathname: '/request/new', params: { repeatId: r.id } })} testID="detail-repeat" />
        </View>
      ) : null}

      <Card style={styles.block}>
        <View style={styles.row}>
          <CategoryIcon icon={r.category.icon} size={18} />
          <View style={styles.rowText}>
            <AppText variant="bodyStrong">{r.category.name}</AppText>
            <AppText variant="caption" color="textMuted" testID="detail-timing">
              {t(`common:timing.${r.timing}`)} · {formatDateTime(r.timing === 'SCHEDULED' && r.scheduledAt ? r.scheduledAt : r.createdAt)}
            </AppText>
          </View>
        </View>
        <Section label={t('common:fields.address')}>
          <AppText variant="body">{r.address.formatted}</AppText>
          {details ? (
            <AppText variant="caption" color="textMuted">
              {details}
            </AppText>
          ) : null}
        </Section>
        <Section label={t('common:fields.description')}>
          <AppText variant="body" testID="detail-description">
            {r.description}
          </AppText>
        </Section>
        {r.photos.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photos}>
            {r.photos.map((p) => (
              <Image key={p.id} source={{ uri: p.url }} style={styles.photo} testID={`detail-photo-${p.id}`} />
            ))}
          </ScrollView>
        ) : null}
        {r.providerPreference !== 'ANY' ? (
          <Section label={t('request.preference')}>
            <AppText variant="body">{t(`common:providerPreference.${r.providerPreference}`)}</AppText>
          </Section>
        ) : null}
        {r.emergencyFee ? (
          <Section label={t('detail.emergencyFee')}>
            <AppText variant="body" testID="detail-emergency">
              {t('detail.emergencyFeeLine', {
                total: formatMoney(r.emergencyFee.total, locale),
                captured: formatMoney(r.emergencyFee.captured, locale),
              })}
            </AppText>
          </Section>
        ) : null}
      </Card>

      <AppText variant="h3" style={styles.sectionTitle}>
        {t('detail.handymen', { filled: r.slotsFilled, total: r.slotsRequested })}
      </AppText>
      {r.slots.map((slot) => {
        const a = slot.assignmentId ? byId.get(slot.assignmentId) : undefined;
        return (
          <Card key={slot.index} style={styles.slot} testID={`detail-slot-${slot.index}`}>
            <View style={styles.row}>
              <AppText variant="small" color="textMuted" style={styles.rowText}>
                {t('detail.slot', { n: slot.index + 1 })}
              </AppText>
              <StatusPill label={t(`slotStatus.${slot.status}`)} tone={slotStatusTone(slot.status)} />
            </View>
            {a ? <AssignmentSummary a={a} /> : null}
          </Card>
        );
      })}
      {r.assignments
        .filter((a) => !r.slots.some((s) => s.assignmentId === a.id))
        .map((a) => (
          <Card key={a.id} style={styles.slot} testID={`detail-past-${a.id}`}>
            <AssignmentSummary a={a} />
          </Card>
        ))}

      {r.cancelledAt ? (
        <AppText variant="small" color="textMuted" style={styles.sectionTitle} testID="detail-cancelled-at">
          {t('detail.cancelledAt', { time: formatDateTime(r.cancelledAt) })}
          {r.cancelReason ? ` · ${r.cancelReason}` : ''}
        </AppText>
      ) : null}

      {r.canCancel ? (
        <Button variant="outline" title={t('detail.cancel')} onPress={() => setConfirm(true)} style={styles.cancel} testID="detail-cancel" />
      ) : null}

      <BottomSheet visible={confirm} onClose={() => setConfirm(false)} title={t('searching.cancelTitle')} testID="detail-cancel-sheet">
        <CancelPreview r={r} />
        <Button variant="danger" title={t('searching.cancelConfirm')} onPress={() => void cancel()} loading={cancelling} testID="detail-cancel-confirm" />
        <View style={styles.gap} />
        <Button variant="outline" title={t('common:actions.close')} onPress={() => setConfirm(false)} testID="detail-cancel-keep" />
      </BottomSheet>
    </Screen>
  );
}

function CancelPreview({ r }: { r: RequestDetail }) {
  const { t, locale } = useT();
  return (
    <AppText variant="body" style={styles.preview} testID="detail-cancel-preview">
      {r.cancelPenaltyPreview > 0 ? t('searching.cancelPenalty', { amount: formatMoney(r.cancelPenaltyPreview, locale) }) : t('searching.cancelFree')}
    </AppText>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <AppText variant="caption" color="textMuted">
        {label}
      </AppText>
      {children}
    </View>
  );
}

/** Provider card inside a slot: photo, name, rating, completed jobs, company, status (no phone before contact unlock). */
function AssignmentSummary({ a }: { a: CustomerAssignment }) {
  const { t } = useT();
  const p = a.provider;
  return (
    <Pressable
      style={[styles.row, styles.assignment]}
      onPress={() => router.push(`/assignment/${a.id}` as never)}
      accessibilityRole="button"
      accessibilityHint={t('detail.track')}
      testID={`detail-assignment-${a.id}`}
    >
      <Avatar uri={p.photo?.url} firstName={p.firstName} lastName={p.lastName} size={44} />
      <View style={styles.rowText}>
        <AppText variant="bodyStrong">{`${p.firstName} ${p.lastName}`.trim()}</AppText>
        <View style={styles.row}>
          {p.ratingAvg !== null ? <Stars value={p.ratingAvg} size={12} showValue /> : null}
          <AppText variant="caption" color="textMuted" style={styles.jobs}>
            {t('detail.jobs', { count: p.completedCount })}
          </AppText>
        </View>
        {p.company ? (
          <AppText variant="caption" color="textMuted">
            {p.company.name}
          </AppText>
        ) : null}
      </View>
      <StatusPill label={t(`common:assignmentStatus.${a.status}`)} tone={assignmentStatusTone(a.status)} />
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} style={styles.chevron} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  block: { marginBottom: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center' },
  rowText: { flex: 1, marginHorizontal: spacing.sm },
  section: { marginTop: spacing.md },
  photos: { marginTop: spacing.md },
  photo: { width: 72, height: 72, borderRadius: 10, marginRight: spacing.sm, backgroundColor: colors.border },
  sectionTitle: { marginTop: spacing.sm, marginBottom: spacing.sm },
  slot: { marginBottom: spacing.sm },
  assignment: { marginTop: spacing.sm },
  jobs: { marginLeft: spacing.xs },
  chevron: { marginLeft: spacing.xs },
  cancel: { marginTop: spacing.lg },
  gap: { height: spacing.sm },
  preview: { marginBottom: spacing.md },
});
