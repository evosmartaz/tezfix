import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type MapView from 'react-native-maps';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import {
  AppText,
  BAKU_REGION,
  Button,
  TfMapView,
  colors,
  ensureLocationPermission,
  openAppSettings,
  radii,
  spacing,
  toPermissionResult,
  useT,
  useToast,
} from '@tezfiks/mobile';
import { currentFix } from '../online/tracking';
import type { LatLngValue } from '../lib/onboarding';

export interface BasePickerProps {
  value: LatLngValue | null;
  onChange: (p: LatLngValue) => void;
  label: string;
  error?: string | null;
  testID?: string;
}

const DELTA = 0.02;

/** Base location: the map is dragged under a fixed centre pin; "Mənim yerim" jumps to the current position. */
export function BasePicker({ value, onChange, label, error, testID = 'base-picker' }: BasePickerProps) {
  const { t } = useT();
  const toast = useToast();
  const mapRef = useRef<MapView>(null);
  const [locating, setLocating] = useState(false);
  const initial = useRef(
    value ? { latitude: value.lat, longitude: value.lng, latitudeDelta: DELTA, longitudeDelta: DELTA } : BAKU_REGION,
  ).current;

  const locate = async (interactive: boolean) => {
    if (interactive) {
      const perm = await ensureLocationPermission();
      if (perm !== 'granted') {
        toast.show(t('online.locationRequired'), {
          kind: 'error',
          ...(perm === 'blocked' ? { actionLabel: t('common:actions.openSettings'), onAction: () => void openAppSettings() } : {}),
        });
        return;
      }
    }
    setLocating(true);
    try {
      const fix = await currentFix();
      if (!fix) {
        if (interactive) toast.show(t('onboarding.locationUnavailable'), { kind: 'error' });
        return;
      }
      onChange({ lat: fix.lat, lng: fix.lng });
      mapRef.current?.animateToRegion?.({ latitude: fix.lat, longitude: fix.lng, latitudeDelta: DELTA, longitudeDelta: DELTA }, 300);
    } finally {
      setLocating(false);
    }
  };

  // Jump to the current position once when location is already allowed (no permission prompt on open).
  useEffect(() => {
    if (value) return;
    let alive = true;
    void (async () => {
      try {
        const perm = toPermissionResult(await Location.getForegroundPermissionsAsync());
        if (alive && perm === 'granted') await locate(false);
      } catch {
        // ignore
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <View style={styles.wrap} testID={testID}>
      <AppText variant="bodyStrong" style={styles.label}>
        {label}
      </AppText>
      <View style={[styles.mapBox, error ? styles.mapError : null]}>
        <TfMapView
          ref={mapRef}
          initialRegion={initial}
          onRegionChangeComplete={(r) => onChange({ lat: r.latitude, lng: r.longitude })}
          style={styles.map}
        />
        <View pointerEvents="none" style={styles.pinWrap}>
          <Ionicons name="location" size={36} color={colors.primary} />
        </View>
      </View>
      <AppText variant="caption" color="textMuted" style={styles.hint} testID={`${testID}-coords`}>
        {value ? t('onboarding.baseSelected', { lat: value.lat.toFixed(5), lng: value.lng.toFixed(5) }) : t('onboarding.baseHint')}
      </AppText>
      <Button
        variant="secondary"
        size="sm"
        title={t('onboarding.useMyLocation')}
        loading={locating}
        onPress={() => void locate(true)}
        icon={<Ionicons name="navigate" size={16} color={colors.primaryDark} />}
        testID={`${testID}-locate`}
      />
      {error ? (
        <AppText variant="small" color="danger" testID={`${testID}-error`}>
          {t(error)}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginVertical: spacing.md },
  label: { marginBottom: spacing.sm },
  mapBox: { height: 200, borderRadius: radii.lg, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  mapError: { borderColor: colors.danger },
  map: { flex: 1 },
  pinWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', paddingBottom: 30 },
  hint: { marginVertical: spacing.sm },
});
