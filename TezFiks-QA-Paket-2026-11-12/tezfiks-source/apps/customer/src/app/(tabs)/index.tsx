import React, { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { api, formatMoney, formatRequestNumber, type Category, type RequestDetail, type Vertical } from '@tezfiks/shared';
import { AppText, Banner, Button, Card, Screen, Segmented, colors, radii, spacing, useApi, useAuth, useT } from '@tezfiks/mobile';
import { CategoryTile } from '../../components/CategoryTile';
import { qk, useCategories, useCustomerAccount, useRequest, useRequestList } from '../../data/queries';
import { useCurrentLocation } from '../../hooks/useCurrentLocation';
import { NotificationBell } from '../../components/NotificationBell';
import { categoryFormHref, featuredServices, servicesOf } from '../../lib/categories';
import { walletTopUpHref } from '../../lib/payments';
import { liveAssignmentId, mayHaveLiveAssignment, mergePages, pickBannerRequest, requestHref } from '../../lib/orders';

/** Board 02 B1/B2: greeting, location, search, Ev/Avto toggle, featured tiles, all categories, find by photo, active request. */
export default function CustomerHome() {
  const { t, locale } = useT();
  const client = useApi();
  const queryClient = useQueryClient();
  const firstName = useAuth((s) => s.me?.firstName ?? '');
  const [vertical, setVertical] = useState<Vertical>('HOME');
  const categories = useCategories();
  const account = useCustomerAccount();
  const active = useRequestList('active');
  const location = useCurrentLocation();
  const coords = location.coords;
  const place = useQuery({
    queryKey: coords ? qk.reverse(coords.lat, coords.lng, locale) : ['geo', 'reverse', 'none'],
    queryFn: () => client.call(api.geo.reverse, { query: { lat: (coords as { lat: number }).lat, lng: (coords as { lng: number }).lng } }),
    enabled: !!coords,
    staleTime: 10 * 60_000,
    retry: false,
  });

  const items = categories.data ?? [];
  const tiles = useMemo(() => featuredServices(items, vertical), [items, vertical]);
  const totalServices = useMemo(() => servicesOf(items).length, [items]);
  const banner = pickBannerRequest(mergePages(active.data?.pages));
  const wallet = account.data?.wallet;
  // Prefetched so the banner can open the live tracking of the one handyman at work without a wait (spec B5).
  const bannerTracksJob = !!banner && mayHaveLiveAssignment(banner);
  useRequest(bannerTracksJob ? banner.id : undefined);
  const opening = useRef(false);

  const openBanner = async () => {
    if (!banner || opening.current) return;
    opening.current = true;
    let href = requestHref(banner);
    try {
      if (bannerTracksJob) {
        // Normally prefetched; otherwise one direct call (no query retries: a failing server must not delay the tap).
        let d = queryClient.getQueryData<RequestDetail>(qk.request(banner.id));
        if (!d) {
          d = await client.call(api.requests.get, { params: { id: banner.id } });
          queryClient.setQueryData(qk.request(banner.id), d);
        }
        const live = liveAssignmentId(d);
        if (live) href = `/assignment/${live}`;
      }
    } catch {
      // The detail screen loads (and explains) the request itself.
    } finally {
      opening.current = false;
    }
    router.push(href as never);
  };

  const openCategory = (c: Category) => router.push(categoryFormHref(c));
  const isCompany = (account.data?.type ?? null) === 'COMPANY';
  const placeText = place.data ? [place.data.district, place.data.street].filter(Boolean).join(', ') || place.data.formatted : t('home.locationDefault');

  return (
    <Screen padded={false} edges={['top']} testID="home-screen">
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <AppText variant="h2" color="textInverse" style={styles.flex}>
              {t('home.greeting', { name: firstName })}
            </AppText>
            <NotificationBell dark testID="home-bell" />
          </View>
          <View style={styles.locationRow} testID="home-location">
            <Ionicons name="location-outline" size={14} color={colors.textInverseMuted} />
            <AppText variant="small" color="textInverseMuted" numberOfLines={1} style={styles.locationText}>
              {placeText}
            </AppText>
          </View>
          <Pressable
            style={styles.search}
            onPress={() => router.push({ pathname: '/categories', params: { vertical, focus: '1' } })}
            accessibilityRole="search"
            testID="home-search"
          >
            <Ionicons name="search" size={18} color={colors.textInverseMuted} />
            <AppText variant="small" color="textInverseMuted" style={styles.searchText}>
              {t(vertical === 'AUTO' ? 'home.searchAuto' : 'home.searchHome')}
            </AppText>
          </Pressable>
        </View>

        <View style={styles.body}>
          {wallet?.isDebt ? (
            <View testID="home-debt">
              <Banner tone="danger" title={t('home.debtTitle')} message={t('home.debtMessage', { amount: formatMoney(-wallet.posted, locale) })} />
              <Button variant="danger" size="sm" title={t('common:actions.topUp')} onPress={() => router.push(walletTopUpHref(-wallet.posted))} fullWidth={false} testID="home-debt-topup" />
              <View style={styles.gap} />
            </View>
          ) : null}

          {banner ? (
            <Card dark onPress={() => void openBanner()} style={styles.active} testID="home-active-request">
              <View style={styles.activeRow}>
                <View style={styles.pulse} />
                <View style={styles.flex}>
                  <AppText variant="caption" color="textInverseMuted">
                    {t('home.activeRequest', { number: formatRequestNumber(banner.number) })}
                  </AppText>
                  <AppText variant="bodyStrong" color="textInverse" numberOfLines={1}>
                    {banner.category.name} · {t(`common:requestStatus.${banner.status}`)}
                  </AppText>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.textInverse} />
              </View>
            </Card>
          ) : null}

          <Segmented
            options={[
              { value: 'HOME', label: t('common:vertical.HOME') },
              { value: 'AUTO', label: t('common:vertical.AUTO') },
            ]}
            value={vertical}
            onChange={setVertical}
            testID="home-vertical"
          />
          {vertical === 'AUTO' ? (
            <View style={styles.autoHint} testID="home-auto-hint">
              <AppText variant="caption" color="primaryDark">
                {t('home.autoHint')}
              </AppText>
            </View>
          ) : null}

          <AppText variant="h3" style={styles.sectionTitle}>
            {t('home.categoriesTitle')}
          </AppText>
          {categories.isError && !items.length ? (
            <Card testID="home-categories-error">
              <AppText variant="small" color="textMuted">
                {t('home.categoriesError')}
              </AppText>
              <Button variant="ghost" size="sm" fullWidth={false} title={t('common:actions.retry')} onPress={() => void categories.refetch()} testID="home-categories-retry" />
            </Card>
          ) : (
            <View style={styles.grid} testID="home-tiles">
              {tiles.map((c) => (
                <View key={c.id} style={styles.cell}>
                  <CategoryTile category={c} onPress={openCategory} />
                </View>
              ))}
            </View>
          )}

          <Pressable
            style={styles.allLink}
            onPress={() => router.push({ pathname: '/categories', params: { vertical } })}
            accessibilityRole="link"
            testID="home-all-categories"
          >
            <AppText variant="small" color="primaryDark" style={styles.allText}>
              {t('home.allCategories', { count: totalServices })}
            </AppText>
            <Ionicons name="arrow-forward" size={16} color={colors.primaryDark} />
          </Pressable>

          <Card onPress={() => router.push({ pathname: '/find-by-photo', params: { vertical } })} style={styles.photo} testID="home-find-by-photo">
            <View style={styles.activeRow}>
              <View style={styles.photoIcon}>
                <Ionicons name="camera" size={22} color={colors.textInverse} />
              </View>
              <View style={styles.flex}>
                <AppText variant="bodyStrong">{t('home.findByPhoto')}</AppText>
                <AppText variant="caption" color="textMuted">
                  {t('home.findByPhotoHint')}
                </AppText>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
            </View>
          </Card>

          {isCompany ? (
            <Card onPress={() => router.push('/project/new' as never)} style={styles.photo} testID="home-business">
              <View style={styles.activeRow}>
                <View style={[styles.photoIcon, styles.businessIcon]}>
                  <Ionicons name="briefcase" size={22} color={colors.textInverse} />
                </View>
                <View style={styles.flex}>
                  <AppText variant="bodyStrong">{t('home.business')}</AppText>
                  <AppText variant="caption" color="textMuted">
                    {t('home.businessHint')}
                  </AppText>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
              </View>
            </Card>
          ) : null}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: spacing.xxl },
  flex: { flex: 1 },
  hero: { backgroundColor: colors.dark, paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.lg },
  heroTop: { flexDirection: 'row', alignItems: 'center' },
  businessIcon: { backgroundColor: colors.dark },
  locationRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.xs },
  locationText: { marginLeft: spacing.xs, flex: 1 },
  search: {
    marginTop: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.darkSoft,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    height: 44,
  },
  searchText: { marginLeft: spacing.sm },
  body: { padding: spacing.lg },
  gap: { height: spacing.md },
  active: { marginBottom: spacing.lg },
  activeRow: { flexDirection: 'row', alignItems: 'center' },
  pulse: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.primary, marginRight: spacing.md },
  autoHint: { marginTop: spacing.md, backgroundColor: colors.primarySoft, borderRadius: radii.md, padding: spacing.sm },
  sectionTitle: { marginTop: spacing.lg, marginBottom: spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -spacing.xs },
  cell: { width: '50%', padding: spacing.xs },
  allLink: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    justifyContent: 'center',
    marginTop: spacing.md,
    backgroundColor: colors.primarySoft,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
  },
  allText: { marginRight: spacing.xs, fontFamily: 'Inter_600SemiBold' },
  photo: { marginTop: spacing.lg },
  photoIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
});
