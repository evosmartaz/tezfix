import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Platform, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import * as Device from 'expo-device';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { Ionicons } from '@expo/vector-icons';
import {
  AppText,
  Badge,
  Button,
  Card,
  Header,
  Screen,
  colors,
  ensureLocationPermission,
  ensureNotificationPermission,
  openAppSettings,
  spacing,
  toPermissionResult,
  useT,
  type PermissionResult,
} from '@tezfiks/mobile';
import { BATTERY_SETTINGS_INTENTS, batteryGuideKey } from '../lib/device';
import { clearOfferAlert, playOfferAlert } from '../online/alert';

type Perm = PermissionResult | 'unknown';

const TONE: Record<Perm, 'success' | 'warning' | 'danger' | 'neutral'> = { granted: 'success', denied: 'warning', blocked: 'danger', unknown: 'neutral' };

async function openBatterySettings(): Promise<void> {
  if (Platform.OS === 'android') {
    for (const action of BATTERY_SETTINGS_INTENTS) {
      try {
        await Linking.sendIntent(action);
        return;
      } catch {
        // try the next one
      }
    }
  }
  await openAppSettings();
}

/** Id of the local test alert (one at a time; a new test replaces the previous one). */
export const TEST_OFFER_ALERT_ID = 'device-test-offer';
const TEST_ALERT_CLEAR_MS = 10_000;

/**
 * Device setup (spec §7): notification and location permissions, battery optimization guidance per manufacturer
 * (expo-device), and a test offer: the same vibration and offers_v1 sound as a real incoming offer.
 */
export default function DeviceSetup() {
  const { t } = useT();
  const [notif, setNotif] = useState<Perm>('unknown');
  const [loc, setLoc] = useState<Perm>('unknown');

  const refresh = useCallback(async () => {
    try {
      setNotif(toPermissionResult(await Notifications.getPermissionsAsync()));
    } catch {
      setNotif('unknown');
    }
    try {
      setLoc(toPermissionResult(await Location.getForegroundPermissionsAsync()));
    } catch {
      setLoc('unknown');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const ask = async (kind: 'notif' | 'loc') => {
    const current = kind === 'notif' ? notif : loc;
    if (current === 'blocked') {
      await openAppSettings();
      return;
    }
    const res = kind === 'notif' ? await ensureNotificationPermission() : await ensureLocationPermission();
    if (kind === 'notif') setNotif(res);
    else setLoc(res);
  };

  const [testSent, setTestSent] = useState(false);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (clearTimer.current) clearTimeout(clearTimer.current);
    },
    [],
  );
  const testOffer = async () => {
    if (clearTimer.current) clearTimeout(clearTimer.current);
    await clearOfferAlert(TEST_OFFER_ALERT_ID);
    await playOfferAlert(TEST_OFFER_ALERT_ID, { title: t('offer.newTitle'), body: t('device.testAlertBody') });
    setTestSent(true);
    clearTimer.current = setTimeout(() => void clearOfferAlert(TEST_OFFER_ALERT_ID), TEST_ALERT_CLEAR_MS);
  };

  const manufacturer = Device.manufacturer ?? null;
  const brand = Device.brand ?? null;

  const item = (kind: 'notif' | 'loc', icon: React.ComponentProps<typeof Ionicons>['name'], title: string, body: string, state: Perm) => (
    <Card style={styles.card} testID={`device-${kind}`}>
      <View style={styles.row}>
        <Ionicons name={icon} size={22} color={colors.primary} />
        <AppText variant="bodyStrong" style={styles.title}>
          {title}
        </AppText>
        <Badge label={t(`device.state.${state}`)} tone={TONE[state]} testID={`device-${kind}-state`} />
      </View>
      <AppText variant="small" color="textMuted" style={styles.body}>
        {body}
      </AppText>
      {state !== 'granted' ? (
        <Button
          size="sm"
          variant="secondary"
          title={state === 'blocked' ? t('common:actions.openSettings') : t('device.allow')}
          onPress={() => void ask(kind)}
          testID={`device-${kind}-allow`}
        />
      ) : null}
    </Card>
  );

  return (
    <Screen scroll testID="device-setup-screen">
      <Header title={t('device.title')} subtitle={t('device.intro')} onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
      {item('notif', 'notifications-outline', t('device.notifications'), t('device.notificationsBody'), notif)}
      {item('loc', 'location-outline', t('device.location'), t('device.locationBody'), loc)}
      <Card style={styles.card} testID="device-test">
        <View style={styles.row}>
          <Ionicons name="megaphone-outline" size={22} color={colors.primary} />
          <AppText variant="bodyStrong" style={styles.title}>
            {t('device.testTitle')}
          </AppText>
        </View>
        <AppText variant="small" color="textMuted" style={styles.body}>
          {t('device.testBody')}
        </AppText>
        {testSent ? (
          <AppText variant="small" style={styles.body} testID="device-test-sent">
            {t('device.testSent')}
          </AppText>
        ) : null}
        <Button size="sm" variant="secondary" title={t('device.testButton')} onPress={() => void testOffer()} testID="device-test-offer" />
      </Card>
      <Card style={styles.card} testID="device-battery">
        <View style={styles.row}>
          <Ionicons name="battery-charging-outline" size={22} color={colors.primary} />
          <AppText variant="bodyStrong" style={styles.title}>
            {t('device.batteryTitle')}
          </AppText>
        </View>
        <AppText variant="small" color="textMuted" style={styles.body}>
          {t('device.batteryIntro', { device: [manufacturer, Device.modelName].filter(Boolean).join(' ') || t('device.thisPhone') })}
        </AppText>
        <AppText variant="small" style={styles.body} testID="device-battery-guide">
          {t(batteryGuideKey(manufacturer, brand))}
        </AppText>
        <Button size="sm" variant="secondary" title={t('device.openBattery')} onPress={() => void openBatterySettings()} testID="device-battery-open" />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center' },
  title: { flex: 1, marginLeft: spacing.sm },
  body: { marginTop: spacing.xs, marginBottom: spacing.sm },
});
