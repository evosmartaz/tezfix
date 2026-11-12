import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@tezfiks/shared';
import { AppText, Button, Header, LoadingState, Screen, errorMessage, spacing, useApi, useT, useToast } from '@tezfiks/mobile';
import { BasePicker } from '../components/BasePicker';
import { RadiusSlider } from '../components/RadiusSlider';
import { TradePicker } from '../components/TradePicker';
import { qk, useProProfile } from '../hooks/queries';
import { SOLO_MAX_TRADES, SOLO_RADIUS, clampRadius, isValidLatLng, type LatLngValue } from '../lib/onboarding';

function back() {
  if (router.canGoBack()) router.back();
  else router.replace('/profile' as never);
}

/** Work profile of a solo handyman: trades, service radius 2–25 km, base location (PATCH /pro/profile). */
export default function ProfileEdit() {
  const { t } = useT();
  const client = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const profile = useProProfile();
  const p = profile.data?.profile ?? null;
  const [tradeIds, setTradeIds] = useState<string[]>([]);
  const [radius, setRadius] = useState<number>(SOLO_RADIUS.default);
  const [base, setBase] = useState<LatLngValue | null>(null);
  const [tradeError, setTradeError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!p || loaded) return;
    setTradeIds(p.trades.map((x) => x.id));
    setRadius(clampRadius(p.serviceRadiusKm, SOLO_RADIUS));
    setBase(p.base ? { lat: p.base.lat, lng: p.base.lng } : null);
    setLoaded(true);
  }, [p, loaded]);

  const save = async () => {
    if (!tradeIds.length) {
      setTradeError(t('onboarding.errors.tradesRequired'));
      return;
    }
    setTradeError(null);
    setSaving(true);
    try {
      const updated = await client.call(api.pro.updateProfile, {
        body: { tradeIds, serviceRadiusKm: clampRadius(radius, SOLO_RADIUS), ...(isValidLatLng(base) ? { base } : {}) },
      });
      queryClient.setQueryData(qk.profile, (cur: unknown) =>
        cur && typeof cur === 'object' ? { ...(cur as Record<string, unknown>), profile: updated } : cur,
      );
      void queryClient.invalidateQueries({ queryKey: qk.profile });
      toast.show(t('profile.saved'), { kind: 'success' });
      back();
    } catch (err) {
      toast.show(errorMessage(t, err), { kind: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen scroll testID="profile-edit-screen" footer={<Button title={t('common:actions.save')} onPress={() => void save()} loading={saving} disabled={!loaded} testID="profile-edit-save" />}>
      <Header title={t('profile.editTitle')} onBack={back} />
      {!loaded ? <LoadingState /> : null}
      {loaded ? (
        <View>
          <AppText variant="bodyStrong" style={styles.label}>
            {t('onboarding.trades')}
          </AppText>
          <TradePicker value={tradeIds} onChange={setTradeIds} max={SOLO_MAX_TRADES} error={tradeError} />
          <View style={styles.block}>
            <RadiusSlider value={radius} onChange={setRadius} min={SOLO_RADIUS.min} max={SOLO_RADIUS.max} />
          </View>
          <View style={styles.block}>
            <BasePicker value={base} onChange={setBase} label={t('profile.base')} />
          </View>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { marginBottom: spacing.sm },
  block: { marginTop: spacing.lg },
});
