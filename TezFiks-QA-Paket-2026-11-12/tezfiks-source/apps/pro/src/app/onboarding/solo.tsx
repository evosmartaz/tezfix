import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@tezfiks/shared';
import {
  AppText,
  Avatar,
  Button,
  Header,
  Screen,
  TextField,
  errorCodeOf,
  errorMessage,
  spacing,
  uploadImage,
  useApi,
  useAuth,
  useT,
  useToast,
} from '@tezfiks/mobile';
import { BasePicker } from '../../components/BasePicker';
import { RadiusSlider } from '../../components/RadiusSlider';
import { TradePicker } from '../../components/TradePicker';
import { qk, useRefreshMe } from '../../hooks/queries';
import { useFieldReveal } from '../../hooks/useFieldReveal';
import { setEntryNext } from '../../lib/entry';
import {
  SOLO_FIELD_ORDER,
  SOLO_MAX_TRADES,
  SOLO_RADIUS,
  validateSoloForm,
  type FormErrors,
  type LatLngValue,
  type SoloField,
} from '../../lib/onboarding';

/** "Fərdi usta": names, photo, trades, radius 2–25 km, base location → POST /pro/onboarding/solo, then KYC. */
export default function SoloOnboarding() {
  const { t } = useT();
  const client = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const refreshMe = useRefreshMe();
  const me = useAuth((s) => s.me);
  const [firstName, setFirstName] = useState(me?.firstName ?? '');
  const [lastName, setLastName] = useState(me?.lastName ?? '');
  const [photo, setPhoto] = useState<{ id: string; url: string } | null>(me?.photo ? { id: me.photo.id, url: me.photo.url } : null);
  const [uploading, setUploading] = useState(false);
  const [tradeIds, setTradeIds] = useState<string[]>([]);
  const [radiusKm, setRadiusKm] = useState<number>(SOLO_RADIUS.default);
  const [base, setBase] = useState<LatLngValue | null>(null);
  const [errors, setErrors] = useState<FormErrors<SoloField>>({});
  const [saving, setSaving] = useState(false);
  const { scrollRef, onLayout, inputRef, reveal } = useFieldReveal(SOLO_FIELD_ORDER);

  const pickPhoto = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8 });
    const a = !res.canceled ? res.assets?.[0] : undefined;
    if (!a?.uri) return;
    setUploading(true);
    try {
      const ref = await uploadImage(client, { uri: a.uri, width: a.width, height: a.height, mimeType: a.mimeType, fileName: a.fileName }, 'PROFILE_PHOTO');
      setPhoto({ id: ref.id, url: ref.url });
    } catch (err) {
      toast.show(errorMessage(t, err), { kind: 'error' });
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    const { errors: errs, body } = validateSoloForm({ firstName, lastName, photoFileId: photo?.id ?? null, tradeIds, radiusKm, base });
    setErrors(errs);
    if (!body) {
      // the invalid field may be far above or below the pinned button: say so and take the pro there
      toast.show(t('onboarding.errors.fixFields'), { kind: 'error' });
      reveal(errs);
      return;
    }
    setSaving(true);
    try {
      await client.call(api.pro.onboardSolo, { body });
      // The refreshed session moves the user out of onboarding; the gate opens the KYC flow next.
      setEntryNext('/kyc');
      void queryClient.invalidateQueries({ queryKey: qk.profile });
      await refreshMe();
    } catch (err) {
      const code = errorCodeOf(err);
      toast.show(errorMessage(t, err), { kind: 'error' });
      if (code === 'ALREADY_HANDYMAN' || code === 'ALREADY_IN_COMPANY') await refreshMe().catch(() => undefined);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen
      padded={false}
      testID="solo-onboarding-screen"
      footer={<Button title={t('onboarding.continueToKyc')} onPress={() => void submit()} loading={saving} disabled={uploading} testID="solo-submit" />}
    >
      <ScrollView ref={scrollRef} style={styles.flex} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Header title={t('onboarding.soloTitle')} subtitle={t('onboarding.soloFormSubtitle')} onBack={() => router.back()} />
        <View style={styles.photoRow}>
          <Pressable onPress={() => void pickPhoto()} accessibilityRole="button" accessibilityLabel={t('auth.addPhoto')} testID="solo-photo">
            <Avatar uri={photo?.url} firstName={firstName} lastName={lastName} size={72} />
          </Pressable>
          <View style={styles.photoText}>
            <AppText variant="bodyStrong">{photo ? t('auth.changePhoto') : t('auth.addPhoto')}</AppText>
            <AppText variant="caption" color="textMuted">
              {uploading ? t('common:states.loading') : t('onboarding.photoHint')}
            </AppText>
          </View>
        </View>
        <View onLayout={onLayout('firstName')} testID="solo-field-firstName">
          <TextField
            ref={inputRef('firstName')}
            label={t('common:fields.firstName')}
            value={firstName}
            onChangeText={setFirstName}
            error={errors.firstName ? t(errors.firstName) : null}
            testID="solo-first-name"
          />
        </View>
        <View onLayout={onLayout('lastName')} testID="solo-field-lastName">
          <TextField
            ref={inputRef('lastName')}
            label={t('common:fields.lastName')}
            value={lastName}
            onChangeText={setLastName}
            error={errors.lastName ? t(errors.lastName) : null}
            testID="solo-last-name"
          />
        </View>
        <View onLayout={onLayout('trades')} testID="solo-field-trades">
          <TradePicker value={tradeIds} onChange={setTradeIds} max={SOLO_MAX_TRADES} error={errors.trades} />
        </View>
        <View onLayout={onLayout('radius')} testID="solo-field-radius">
          <RadiusSlider value={radiusKm} onChange={setRadiusKm} min={SOLO_RADIUS.min} max={SOLO_RADIUS.max} error={errors.radius} />
        </View>
        <View onLayout={onLayout('base')} testID="solo-field-base">
          <BasePicker value={base} onChange={setBase} label={t('onboarding.base')} error={errors.base} />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // the form scrolls itself (instead of Screen scroll) so a failed submit can scroll to the invalid field
  flex: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  photoRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.lg },
  photoText: { marginLeft: spacing.md, flex: 1 },
});
