import React, { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import type MapView from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { api, type SavedAddress } from '@tezfiks/shared';
import {
  AppText,
  BAKU_REGION,
  Button,
  Header,
  Screen,
  TextField,
  TfMapView,
  colors,
  ensureLocationPermission,
  radii,
  spacing,
  useApi,
  useT,
} from '@tezfiks/mobile';
import {
  ADDRESS_MAX,
  applyGeoAddress,
  applyPin,
  hasPin,
  savedAddressToDraft,
  validateAddressDraft,
  type AddressDraft,
  type AddressTextField,
} from '../lib/address';
import { readPosition } from '../hooks/useCurrentLocation';

export interface AddressPickerProps {
  visible: boolean;
  value: AddressDraft;
  saved: SavedAddress[];
  saveAddress: boolean;
  saveLabel: string;
  onClose: () => void;
  onConfirm: (draft: AddressDraft, save: { saveAddress: boolean; saveLabel: string }) => void;
}

const PIN_DELTA = 0.01;
/** ~1 m: map region centres are reported with float noise. */
const SAME_PIN_EPS = 1e-5;
/** Reverse geocoding waits for the map to settle. */
const GEOCODE_DEBOUNCE_MS = 600;

const FIELD_ROWS: AddressTextField[][] = [['district'], ['street', 'building'], ['block', 'entrance', 'floor'], ['apartment', 'intercom'], ['note']];

/**
 * Board 02 B3 address step: map pin (current location, reverse geocoded by the API), saved addresses and the structured
 * fields only the customer knows (block, entrance, floor, apartment, intercom, note). The pin is the dispatch truth.
 */
export function AddressPicker({ visible, value, saved, saveAddress, saveLabel, onClose, onConfirm }: AddressPickerProps) {
  const { t } = useT();
  const client = useApi();
  const mapRef = useRef<MapView>(null);
  const [draft, setDraft] = useState<AddressDraft>(value);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [save, setSave] = useState(saveAddress);
  const [label, setLabel] = useState(saveLabel);
  const [geocoding, setGeocoding] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (visible) {
      setDraft(value);
      setSave(saveAddress);
      setLabel(saveLabel);
      setError(null);
    }
    // Reset only when the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const geocode = (lat: number, lng: number) => {
    const my = ++seq.current;
    setGeocoding(true);
    client
      .call(api.geo.reverse, { query: { lat, lng } })
      .then((geo) => {
        if (my === seq.current) setDraft((d) => applyGeoAddress(d, geo));
      })
      .catch(() => undefined)
      .finally(() => {
        if (my === seq.current) setGeocoding(false);
      });
  };

  /** True when (lat, lng) is the current pin (the map reports its initial region on load; that is not a move). */
  const isCurrentPin = (lat: number, lng: number) => {
    const d = draftRef.current;
    return d.lat !== null && d.lng !== null && Math.abs(d.lat - lat) < SAME_PIN_EPS && Math.abs(d.lng - lng) < SAME_PIN_EPS;
  };

  const movePin = (lat: number, lng: number, opts: { geocode?: boolean; animate?: boolean } = {}) => {
    if (isCurrentPin(lat, lng) && !opts.animate) return;
    setDraft((d) => applyPin(d, lat, lng));
    setError(null);
    if (opts.animate) mapRef.current?.animateToRegion?.({ latitude: lat, longitude: lng, latitudeDelta: PIN_DELTA, longitudeDelta: PIN_DELTA }, 400);
    if (opts.geocode !== false) {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => geocode(lat, lng), GEOCODE_DEBOUNCE_MS);
    }
  };

  const useMyLocation = async () => {
    setLocating(true);
    const perm = await ensureLocationPermission();
    const pos = perm === 'granted' ? await readPosition() : null;
    setLocating(false);
    if (!pos) {
      setError(t(perm === 'granted' ? 'address.locationUnavailable' : 'address.locationDenied'));
      return;
    }
    movePin(pos.lat, pos.lng, { animate: true });
  };

  const pickSaved = (a: SavedAddress) => {
    if (timer.current) clearTimeout(timer.current);
    seq.current++;
    setGeocoding(false);
    setDraft(savedAddressToDraft(a));
    setSave(false);
    mapRef.current?.animateToRegion?.({ latitude: a.lat, longitude: a.lng, latitudeDelta: PIN_DELTA, longitudeDelta: PIN_DELTA }, 400);
  };

  const confirm = () => {
    const problem = validateAddressDraft(draft);
    if (problem) {
      setError(t(problem));
      return;
    }
    if (save && !label.trim()) {
      setError(t('address.labelRequired'));
      return;
    }
    onConfirm(draft, { saveAddress: save, saveLabel: label });
  };

  const setField = (f: AddressTextField | 'formatted', v: string) => setDraft((d) => ({ ...d, [f]: v }));
  const initialRegion = hasPin(value) ? { latitude: value.lat, longitude: value.lng, latitudeDelta: PIN_DELTA, longitudeDelta: PIN_DELTA } : BAKU_REGION;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <Screen
        padded={false}
        testID="address-picker"
        footer={<Button title={t('address.confirm')} onPress={confirm} disabled={geocoding} testID="address-confirm" />}
      >
        <View style={styles.mapWrap}>
          <TfMapView
            ref={mapRef}
            initialRegion={initialRegion}
            onRegionChangeComplete={(r) => movePin(r.latitude, r.longitude)}
            showsUserLocation
            showsMyLocationButton={false}
          />
          <View pointerEvents="none" style={styles.pinWrap}>
            <Ionicons name="location" size={40} color={colors.primary} />
          </View>
          <Pressable style={styles.close} onPress={onClose} accessibilityRole="button" accessibilityLabel={t('common:actions.close')} testID="address-close">
            <Ionicons name="close" size={22} color={colors.text} />
          </Pressable>
          <Pressable style={styles.locate} onPress={() => void useMyLocation()} accessibilityRole="button" accessibilityLabel={t('address.useMyLocation')} testID="address-locate">
            <Ionicons name={locating ? 'hourglass-outline' : 'locate'} size={22} color={colors.primary} />
          </Pressable>
        </View>
        <ScrollView style={styles.flex} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Header title={t('address.title')} subtitle={t('address.subtitle')} />
          {error ? (
            <AppText variant="small" color="danger" style={styles.error} testID="address-error">
              {error}
            </AppText>
          ) : null}
          <TextField
            label={t('common:fields.address')}
            value={draft.formatted}
            onChangeText={(v) => setField('formatted', v)}
            maxLength={ADDRESS_MAX.formatted}
            hint={geocoding ? t('address.locating') : undefined}
            testID="address-formatted"
          />
          {saved.length ? (
            <View style={styles.saved}>
              <AppText variant="bodyStrong" style={styles.savedTitle}>
                {t('address.saved')}
              </AppText>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                {saved.map((a) => (
                  <Pressable key={a.id} onPress={() => pickSaved(a)} style={styles.chip} testID={`saved-address-${a.id}`} accessibilityRole="button">
                    <Ionicons name={a.isSite ? 'business-outline' : 'bookmark-outline'} size={14} color={colors.primaryDark} />
                    <AppText variant="small" numberOfLines={1} style={styles.chipText}>
                      {a.label || a.formatted}
                    </AppText>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ) : null}
          {FIELD_ROWS.map((row) => (
            <View key={row.join('-')} style={styles.row}>
              {row.map((f) => (
                <View key={f} style={styles.flex}>
                  <TextField
                    label={t(`common:fields.${f}`)}
                    value={draft[f]}
                    onChangeText={(v) => setField(f, v)}
                    maxLength={ADDRESS_MAX[f]}
                    multiline={f === 'note'}
                    testID={`address-${f}`}
                  />
                </View>
              ))}
            </View>
          ))}
          <View style={styles.saveRow}>
            <AppText variant="bodyStrong" style={styles.flex}>
              {t('address.saveToBook')}
            </AppText>
            <Switch
              value={save}
              onValueChange={setSave}
              trackColor={{ true: colors.primary, false: colors.border }}
              thumbColor={colors.surface}
              testID="address-save-toggle"
            />
          </View>
          {save ? (
            <TextField label={t('address.label')} placeholder={t('address.labelPlaceholder')} value={label} onChangeText={setLabel} maxLength={60} testID="address-label" />
          ) : null}
          <AppText variant="caption" color="textMuted">
            {t('address.pinHint')}
          </AppText>
        </ScrollView>
      </Screen>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  mapWrap: { height: 260 },
  pinWrap: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', paddingBottom: 36 },
  close: { position: 'absolute', top: spacing.md, left: spacing.md, backgroundColor: colors.surface, borderRadius: radii.pill, padding: spacing.sm },
  locate: { position: 'absolute', bottom: spacing.md, right: spacing.md, backgroundColor: colors.surface, borderRadius: radii.pill, padding: spacing.sm },
  body: { padding: spacing.lg },
  error: { marginBottom: spacing.sm },
  saved: { marginBottom: spacing.md },
  savedTitle: { marginBottom: spacing.xs },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    marginRight: spacing.sm,
    maxWidth: 220,
  },
  chipText: { marginLeft: spacing.xs },
  row: { flexDirection: 'row', gap: spacing.sm },
  saveRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
});
