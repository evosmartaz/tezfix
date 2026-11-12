import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { api, formatDateTime, formatMoney, shortName, type OfferCandidateWorker, type OfferView } from '@tezfiks/shared';
import {
  AppText,
  Avatar,
  Badge,
  Button,
  Card,
  Countdown,
  ErrorState,
  ListItem,
  LoadingState,
  colors,
  errorMessage,
  radii,
  spacing,
  useApi,
  useT,
} from '@tezfiks/mobile';
import { VerificationCard } from './VerificationCard';
import { qk } from '../hooks/queries';
import { useCompanyOffers } from '../hooks/useCompanyOffers';
import { defaultSelection, isSelectableWorker, kmLabel, reconcileSelection, sortCandidates, toggleWorker } from '../lib/company';
import { offerWindowSec } from '../lib/offers';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/** Manager mode home (board 04): company + "Balans" chip, today's numbers, incoming orders with the worker picker, menu. */
export function CompanyHome({ companyId }: { companyId: string }) {
  const { t, locale } = useT();
  const client = useApi();
  const company = useQuery({ queryKey: qk.company(companyId), queryFn: () => client.call(api.company.get, { params: { companyId } }) });
  const approved = company.data?.status === 'APPROVED';
  const dashboard = useQuery({
    queryKey: qk.companyDashboard(companyId),
    enabled: approved,
    refetchInterval: 60_000,
    queryFn: () => client.call(api.company.dashboard, { params: { companyId } }),
  });
  if (company.isLoading) return <LoadingState />;
  if (company.isError) return <ErrorState error={company.error} message={errorMessage(t, company.error)} onRetry={() => void company.refetch()} />;
  const c = company.data!;
  const balance = dashboard.data?.wallet.available ?? c.wallet.available;
  return (
    <View testID="home-company-mode">
      <View style={styles.head}>
        <AppText variant="h3" style={styles.flex} numberOfLines={2}>
          {t('mode.managerTitle', { name: c.name })}
        </AppText>
        <Pressable style={styles.balanceChip} onPress={() => router.push('/balance' as never)} testID="company-balance">
          <AppText variant="caption" color="textInverse">
            {t('mode.balanceChip', { amount: formatMoney(balance, locale, { compact: true }) })}
          </AppText>
        </Pressable>
      </View>
      {!approved ? (
        <VerificationCard
          status={c.status}
          rejectReason={c.rejectReason ?? c.kyc.rejectReason}
          attemptsLeft24h={c.kyc.attemptsLeft24h}
          subject="COMPANY"
          onStartKyc={() => router.push({ pathname: '/kyc', params: { subject: 'COMPANY', companyId } } as never)}
        />
      ) : (
        <View>
          <Card testID="company-stats">
            <AppText variant="body">{t('mode.companyStats', { members: dashboard.data?.membersCount ?? c.membersCount, online: dashboard.data?.onlineWorkers ?? c.onlineWorkers })}</AppText>
            {dashboard.data ? (
              <View style={styles.stats}>
                <Stat value={String(dashboard.data.jobsToday)} label={t('company.stats.jobsToday')} testID="company-stat-jobs" />
                <Stat value={String(dashboard.data.activeJobs)} label={t('company.stats.activeJobs')} testID="company-stat-active" />
                <Stat value={formatMoney(dashboard.data.revenueToday, locale, { compact: true })} label={t('company.stats.revenueToday')} testID="company-stat-revenue" />
                <Stat value={formatMoney(-Math.abs(dashboard.data.feesToday), locale, { compact: true })} label={t('company.stats.feesToday')} accent testID="company-stat-fees" />
              </View>
            ) : null}
          </Card>
          <IncomingOrders companyId={companyId} />
        </View>
      )}
      <Card padded={false} style={styles.block}>
        <MenuItem icon="briefcase-outline" title={t('company.menu.jobs')} onPress={() => router.push('/orders' as never)} testID="company-menu-jobs" />
        <MenuItem icon="people-outline" title={t('company.menu.members')} onPress={() => router.push(`/company/${companyId}/members` as never)} testID="company-menu-members" />
        <MenuItem icon="settings-outline" title={t('company.menu.settings')} onPress={() => router.push(`/company/${companyId}/settings` as never)} testID="company-menu-settings" />
        <MenuItem icon="wallet-outline" title={t('company.menu.balance')} onPress={() => router.push('/balance' as never)} testID="company-menu-balance" />
        <MenuItem icon="business-outline" title={t('company.menu.projects')} onPress={() => router.push(`/projects?companyId=${companyId}` as never)} testID="company-menu-projects" last />
      </Card>
    </View>
  );
}

function MenuItem({ icon, title, onPress, testID, last }: { icon: IconName; title: string; onPress: () => void; testID: string; last?: boolean }) {
  return <ListItem title={title} left={<Ionicons name={icon} size={22} color={colors.primary} />} chevron divider={!last} onPress={onPress} testID={testID} />;
}

function Stat({ value, label, accent, testID }: { value: string; label: string; accent?: boolean; testID?: string }) {
  return (
    <View style={styles.stat} testID={testID}>
      <AppText variant="bodyStrong" color={accent ? 'accent' : 'text'}>
        {value}
      </AppText>
      <AppText variant="caption" color="textMuted" numberOfLines={1}>
        {label}
      </AppText>
    </View>
  );
}

function IncomingOrders({ companyId }: { companyId: string }) {
  const { t } = useT();
  const q = useCompanyOffers(companyId, true);
  return (
    <View style={styles.block} testID="company-incoming">
      <AppText variant="h3">{t('company.incoming')}</AppText>
      {!q.offers.length ? (
        <AppText variant="small" color="textMuted" style={styles.line} testID="company-no-offers">
          {t('company.noOffers')}
        </AppText>
      ) : null}
      {q.offers.map((o) => (
        <CompanyOfferCard key={o.id} offer={o} busy={q.busyId === o.id} onAccept={(ids) => void q.accept(o, ids)} onDecline={() => void q.decline(o)} />
      ))}
    </View>
  );
}

/**
 * Incoming order card (board 04): "Yeni sifariş #2851", service, area, timing • customer • rating, countdown,
 * "Qəbulda şirkət balansından 10 AZN tutulacaq", "Ustanı seçin" (Boşdur / Sifarişdədir, rating, distance),
 * İmtina et / Qəbul et və göndər. No phone and no exact address (spec 4.4).
 */
export function CompanyOfferCard({
  offer,
  busy,
  onAccept,
  onDecline,
}: {
  offer: OfferView;
  busy: boolean;
  onAccept: (workerIds: string[]) => void;
  onDecline: () => void;
}) {
  const { t, locale } = useT();
  const max = Math.max(1, offer.slotsOpen);
  const workers = sortCandidates(offer.candidateWorkers);
  const [selected, setSelected] = useState<string[]>(() => defaultSelection(offer.candidateWorkers, max));
  useEffect(() => {
    setSelected((s) => reconcileSelection(s, offer.candidateWorkers, max));
  }, [offer.candidateWorkers, max]);
  const timing =
    offer.timing === 'SCHEDULED' && offer.scheduledAt ? formatDateTime(offer.scheduledAt) : t(`common:timing.${offer.timing}`);
  const rating = offer.customer.ratingAvg !== null ? ` • ★ ${offer.customer.ratingAvg.toFixed(1)}` : '';
  const fee = formatMoney(offer.fee, locale, { compact: true, plain: true });
  return (
    <Card selected style={styles.offer} testID={`company-offer-${offer.id}`}>
      <View style={styles.head}>
        <AppText variant="h3" style={styles.flex}>
          {t('company.offerTitle', { number: offer.requestNumber })}
        </AppText>
        {offer.isEmergency ? <Badge label={t('offer.emergency')} tone="danger" /> : null}
      </View>
      <Countdown
        deadline={offer.expiresAt}
        totalSec={offerWindowSec(offer)}
        format="seconds"
        render={(left) => t('offer.countdown', { count: left })}
        variant="small"
        color="danger"
        testID={`company-offer-countdown-${offer.id}`}
      />
      <AppText variant="small" color="textMuted" style={styles.line}>
        {offer.descriptionShort ? `${offer.category.name} — ${offer.descriptionShort}` : offer.category.name}
      </AppText>
      <AppText variant="small" color="textMuted" testID={`company-offer-area-${offer.id}`}>
        {offer.address.area}
      </AppText>
      <AppText variant="small" color="textMuted" testID={`company-offer-customer-${offer.id}`}>
        {t('company.customerLine', { timing, name: shortName(offer.customer.firstName, offer.customer.lastInitial) })}
        {rating}
      </AppText>
      {offer.slotsRequested > 1 ? (
        <AppText variant="small" color="textMuted">
          {t('company.slots', { open: offer.slotsOpen, total: offer.slotsRequested })}
        </AppText>
      ) : null}
      <View style={styles.feeBox}>
        <AppText variant="small" style={styles.feeText} testID={`company-offer-fee-${offer.id}`}>
          {max > 1 ? t('company.feeNotePerWorker', { fee }) : t('company.feeNote', { fee })}
        </AppText>
      </View>
      <AppText variant="bodyStrong" style={styles.line}>
        {max > 1 ? t('company.pickWorkers', { selected: selected.length, max }) : t('company.pickWorker')}
      </AppText>
      {!workers.length ? (
        <AppText variant="small" color="textMuted" style={styles.line}>
          {t('company.noCandidates')}
        </AppText>
      ) : null}
      {workers.map((w) => (
        <WorkerRow key={w.handymanId} w={w} selected={selected.includes(w.handymanId)} onPress={() => setSelected((s) => toggleWorker(s, w, max))} />
      ))}
      <View style={[styles.head, styles.line]}>
        <Button variant="outline" title={t('company.decline')} onPress={onDecline} disabled={busy} fullWidth={false} style={styles.action} testID={`company-offer-decline-${offer.id}`} />
        <Button
          title={t('company.acceptSend')}
          onPress={() => onAccept(selected)}
          loading={busy}
          disabled={!selected.length}
          fullWidth={false}
          style={styles.action}
          testID={`company-offer-accept-${offer.id}`}
        />
      </View>
    </Card>
  );
}

function WorkerRow({ w, selected, onPress }: { w: OfferCandidateWorker; selected: boolean; onPress: () => void }) {
  const { t, locale } = useT();
  const ok = isSelectableWorker(w);
  const parts = [
    w.ratingAvg !== null ? `★ ${w.ratingAvg.toFixed(1)}` : null,
    kmLabel(w.distanceM, locale),
    !w.online ? t('company.members.offline') : null,
  ].filter(Boolean);
  const state = w.busy ? t('company.busy') : !w.hasTrade ? t('company.noTrade') : t('company.free');
  return (
    <Pressable
      onPress={onPress}
      disabled={!ok}
      style={[styles.worker, selected ? styles.workerOn : null, !ok ? styles.workerOff : null]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected, disabled: !ok }}
      testID={`pick-worker-${w.handymanId}`}
    >
      <Avatar uri={w.photo?.url} firstName={w.firstName} lastName={w.lastName} size={40} />
      <View style={styles.workerText}>
        <AppText variant="bodyStrong">{`${w.firstName} ${w.lastName}`}</AppText>
        <AppText variant="caption" color="textMuted">
          {parts.join(' • ')}
        </AppText>
      </View>
      <Badge label={state} tone={w.busy ? 'warning' : ok ? 'success' : 'neutral'} testID={`pick-worker-state-${w.handymanId}`} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  block: { marginTop: spacing.md },
  line: { marginTop: spacing.sm },
  balanceChip: { backgroundColor: colors.dark, borderRadius: radii.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, marginLeft: spacing.sm },
  stats: { flexDirection: 'row', marginTop: spacing.md, gap: spacing.xs },
  stat: { flex: 1, backgroundColor: colors.background, borderRadius: radii.md, paddingVertical: spacing.sm, alignItems: 'center' },
  offer: { marginTop: spacing.md },
  feeBox: { marginTop: spacing.md, backgroundColor: colors.accentSoft, borderRadius: radii.md, padding: spacing.sm },
  feeText: { color: '#92400E' },
  worker: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm, padding: spacing.sm, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border },
  workerOn: { borderColor: colors.primary, borderWidth: 2 },
  workerOff: { opacity: 0.6 },
  workerText: { flex: 1, marginLeft: spacing.md },
  action: { flex: 1, marginHorizontal: spacing.xs },
});
