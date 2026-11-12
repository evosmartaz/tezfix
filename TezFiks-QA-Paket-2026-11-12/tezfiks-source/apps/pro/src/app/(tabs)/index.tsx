import React, { useCallback, useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { api, formatMoney, type ProProfile } from '@tezfiks/shared';
import {
  AppText,
  Banner,
  Button,
  Card,
  ErrorState,
  ListItem,
  LoadingState,
  MapPin,
  Screen,
  TfMapView,
  colors,
  errorMessage,
  radii,
  shadows,
  spacing,
  upperAzSafe,
  useApi,
  useAuth,
  useT,
} from '@tezfiks/mobile';
import { CompanyHome } from '../../components/CompanyHome';
import { JobStatusBadge } from '../../components/JobParts';
import { ModeSwitcher } from '../../components/ModeSwitcher';
import { OfferModal } from '../../components/OfferModal';
import { VerificationCard } from '../../components/VerificationCard';
import { qk, useJobPages, useProProfile, usePublicConfig } from '../../hooks/queries';
import { useOfferQueue } from '../../hooks/useOfferQueue';
import { useOnlineSession, type OnlineSession } from '../../hooks/useOnlineSession';
import { useProMode } from '../../hooks/useProMode';
import { todayTiles } from '../../lib/home';

/** Home (board 03 B1): personal mode for handymen, the company entry point in manager mode. */
export default function ProHome() {
  const { t } = useT();
  const firstName = useAuth((s) => s.me?.firstName ?? '');
  const profile = useProProfile();
  const mode = useProMode(profile.data);
  // The online session and the offer queue live here, above the personal/company switch: a handyman who manages a
  // company and switches to company mode while online keeps receiving (and seeing) personal offers, and a profile
  // that leaves APPROVED is turned offline by the session itself (plus the app-level useTrackingGuard).
  const pro = profile.data?.profile ?? null;
  const session = useOnlineSession(pro);
  const approved = !!pro && pro.status === 'APPROVED';
  const offers = useOfferQueue(approved && pro.kind === 'SOLO' && session.online);
  // Offers moved aside for a top-up come back on home, or as soon as the balance changes (a top-up landed).
  const { resume } = offers;
  useFocusEffect(useCallback(() => resume(), [resume]));
  const available = pro?.wallet?.available;
  useEffect(() => resume(), [available, resume]);

  return (
    <Screen padded={false} scroll edges={['top']} testID="home-screen" onRefresh={() => void profile.refetch()} refreshing={profile.isRefetching}>
      <View style={styles.hero}>
        <AppText variant="h2" color="textInverse">
          {t('home.greeting', { name: firstName })}
        </AppText>
        <ModeSwitcher profile={profile.data} mode={mode} dark />
      </View>
      <View style={styles.body}>
        {profile.isLoading ? <LoadingState /> : null}
        {profile.isError ? <ErrorState error={profile.error} message={errorMessage(t, profile.error)} onRetry={() => void profile.refetch()} /> : null}
        {profile.data && mode.kind === 'company' ? <CompanyHome key={mode.companyId} companyId={mode.companyId} /> : null}
        {profile.data && mode.kind === 'personal' && pro ? <PersonalHome profile={pro} session={session} /> : null}
      </View>
      <OfferModal
        offer={offers.offer}
        waiting={offers.waiting}
        accepting={offers.accepting}
        error={offers.error}
        onAccept={(o) => void offers.accept(o)}
        onDecline={(o) => void offers.decline(o)}
        onTopUp={offers.topUp}
      />
    </Screen>
  );
}

function PersonalHome({ profile, session }: { profile: ProProfile; session: OnlineSession }) {
  const { t } = useT();
  if (profile.status !== 'APPROVED') {
    const companyless = profile.kind === 'COMPANY_WORKER' && !profile.company;
    return (
      <View testID="home-unverified">
        {companyless ? (
          <Banner tone="info" message={t('home.removedFromCompany')} testID="home-removed" />
        ) : (
          <VerificationCard
            status={profile.status}
            rejectReason={profile.rejectReason ?? profile.kyc.rejectReason}
            attemptsLeft24h={profile.kyc.attemptsLeft24h}
            onStartKyc={() => router.push('/kyc')}
          />
        )}
        <DeviceSetupLink />
      </View>
    );
  }
  return <ApprovedHome profile={profile} session={session} />;
}

function ApprovedHome({ profile, session }: { profile: ProProfile; session: OnlineSession }) {
  const { t, locale } = useT();
  const client = useApi();
  const config = usePublicConfig();
  const solo = profile.kind === 'SOLO';
  const stats = useQuery({ queryKey: qk.statsToday, queryFn: () => client.call(api.pro.statsToday), refetchInterval: 60_000 });
  const tiles = todayTiles(profile);

  const requestFee = config.data?.requestFee ?? 1000;
  const lowBalance = solo && !!profile.wallet && profile.wallet.available < requestFee;
  const position = session.position ?? (profile.base ? { lat: profile.base.lat, lng: profile.base.lng } : null);
  const trade = profile.trades[0]?.name ?? '';
  const initial = Array.from(profile.lastName.trim())[0];
  const name = initial ? `${profile.firstName} ${upperAzSafe(initial)}.` : profile.firstName;
  const title = [name, trade].filter(Boolean).join(' • ');

  return (
    <View testID="home-approved">
      <View style={styles.mapBox}>
        <TfMapView
          style={styles.map}
          region={position ? { latitude: position.lat, longitude: position.lng, latitudeDelta: 0.03, longitudeDelta: 0.03 } : undefined}
        >
          {position ? <MapPin coordinate={{ latitude: position.lat, longitude: position.lng }} kind="target" /> : null}
        </TfMapView>
        <View style={styles.pill}>
          <AppText variant="small" color="textInverse" style={styles.pillName} numberOfLines={1} testID="home-identity">
            {title}
          </AppText>
          <Pressable
            onPress={() => void session.setOnline(!session.online)}
            disabled={session.busy}
            style={[styles.toggle, session.online ? styles.toggleOn : styles.toggleOff]}
            accessibilityRole="switch"
            accessibilityState={{ checked: session.online, busy: session.busy }}
            testID="online-toggle"
          >
            <View style={[styles.dot, { backgroundColor: session.online ? colors.textInverse : colors.textInverseMuted }]} />
            <AppText variant="caption" color="textInverse" style={styles.toggleText}>
              {session.busy ? '…' : session.online ? t('home.online') : t('home.offline')}
            </AppText>
          </Pressable>
        </View>
      </View>

      <ActiveJobCard />

      {profile.company ? (
        <AppText variant="small" color="textMuted" style={styles.companyLine} testID="home-company">
          {t('home.workerOf', { company: profile.company.name })}
        </AppText>
      ) : null}

      {lowBalance ? (
        <View style={styles.block}>
          <Banner
            tone="warning"
            title={t('home.lowBalanceTitle', { balance: formatMoney(profile.wallet!.available, locale) })}
            message={t('home.lowBalance', { fee: formatMoney(requestFee, locale, { compact: true }) })}
            testID="home-low-balance"
          />
          <Button variant="primary" size="sm" title={t('home.topUp')} onPress={() => router.push('/balance' as never)} testID="home-topup" />
        </View>
      ) : null}
      {session.warnings
        .filter((w) => !(w === 'LOW_BALANCE' && lowBalance))
        .map((w) => (
          <View key={w} style={styles.block}>
            <Banner tone="warning" message={t(`home.warning.${w}`)} testID={`home-warning-${w}`} />
          </View>
        ))}
      {session.online ? (
        <AppText variant="small" color="textMuted" style={styles.companyLine} testID="home-online-hint">
          {solo ? t('home.waitingOffers') : t('home.waitingCompany')}
        </AppText>
      ) : null}

      <Card style={styles.block} testID="home-today">
        <AppText variant="h3">{t('home.today')}</AppText>
        {stats.data ? (
          <View style={styles.stats}>
            <Stat value={String(stats.data.jobs)} label={t('home.statJobs')} testID="stat-jobs" />
            {tiles.earnings ? (
              <Stat value={formatMoney(stats.data.earnings, locale, { compact: true })} label={t('home.statEarnings')} testID="stat-earnings" />
            ) : null}
            {tiles.fees ? (
              <Stat
                value={formatMoney(-Math.abs(stats.data.fees), locale, { compact: true })}
                label={t('home.statFees')}
                accent
                testID="stat-fees"
              />
            ) : null}
          </View>
        ) : stats.isError ? (
          <AppText variant="small" color="textMuted">
            {errorMessage(t, stats.error)}
          </AppText>
        ) : (
          <LoadingState />
        )}
      </Card>

      {solo ? (
        <Card padded={false} style={styles.block}>
          <ListItem
            title={t('scheduled.title')}
            subtitle={t('scheduled.subtitle')}
            left={<Ionicons name="calendar-outline" size={22} color={colors.primary} />}
            chevron
            divider={false}
            onPress={() => router.push('/scheduled')}
            testID="home-scheduled"
          />
        </Card>
      ) : null}
      <DeviceSetupLink />
    </View>
  );
}

function Stat({ value, label, accent, testID }: { value: string; label: string; accent?: boolean; testID?: string }) {
  return (
    <View style={styles.stat} testID={testID}>
      <AppText variant="h3" color={accent ? 'accent' : 'text'}>
        {value}
      </AppText>
      <AppText variant="caption" color="textMuted">
        {label}
      </AppText>
    </View>
  );
}

function DeviceSetupLink() {
  const { t } = useT();
  return (
    <Card padded={false} style={styles.block}>
      <ListItem
        title={t('device.title')}
        subtitle={t('device.subtitle')}
        left={<Ionicons name="phone-portrait-outline" size={22} color={colors.primary} />}
        chevron
        divider={false}
        onPress={() => router.push('/device-setup')}
        testID="home-device-setup"
      />
    </Card>
  );
}

/** Shortcut to the running job ("Aktiv sifariş #2847 · Yoldadır"); errors are silent (the orders tab shows them). */
function ActiveJobCard() {
  const { t } = useT();
  // Same cache entry as the Orders tab (useJobPages): the shortcut is the first active job of the first page.
  const active = useJobPages('active', null, { refetchInterval: 60_000 });
  const job = active.data?.pages[0]?.items[0];
  if (!job) return null;
  return (
    <Card style={styles.block} onPress={() => router.push(`/job/${job.id}` as never)} testID="home-active-job">
      <View style={styles.activeRow}>
        <Ionicons name="construct-outline" size={22} color={colors.primary} />
        <AppText variant="bodyStrong" style={styles.activeText} numberOfLines={1}>
          {t('job.title', { number: job.requestNumber })}
        </AppText>
        <JobStatusBadge job={job} testID="home-active-job-status" />
      </View>
      <AppText variant="small" color="textMuted" style={styles.companyLine} numberOfLines={1}>
        {job.address.formatted}
      </AppText>
    </Card>
  );
}

const styles = StyleSheet.create({
  hero: { backgroundColor: colors.dark, paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.md },
  body: { padding: spacing.lg },
  mapBox: { height: 300, borderRadius: radii.lg, overflow: 'hidden', ...shadows.card },
  map: { flex: 1 },
  pill: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
    right: spacing.md,
    backgroundColor: colors.dark,
    borderRadius: radii.pill,
    paddingLeft: spacing.lg,
    paddingRight: spacing.xs,
    paddingVertical: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
  },
  pillName: { flex: 1, marginRight: spacing.sm },
  toggle: { flexDirection: 'row', alignItems: 'center', borderRadius: radii.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  toggleOn: { backgroundColor: colors.primary },
  toggleOff: { backgroundColor: colors.darkSoft },
  toggleText: { fontWeight: '700', marginLeft: spacing.xs },
  dot: { width: 8, height: 8, borderRadius: 4 },
  block: { marginTop: spacing.md },
  companyLine: { marginTop: spacing.sm },
  stats: { flexDirection: 'row', marginTop: spacing.md, gap: spacing.sm },
  stat: { flex: 1, backgroundColor: colors.background, borderRadius: radii.md, paddingVertical: spacing.md, alignItems: 'center' },
  flex: { flex: 1 },
  activeRow: { flexDirection: 'row', alignItems: 'center' },
  activeText: { flex: 1, marginHorizontal: spacing.sm },
});
