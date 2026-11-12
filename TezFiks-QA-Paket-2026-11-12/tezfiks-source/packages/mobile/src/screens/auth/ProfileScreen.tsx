import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { api, type Me } from '@tezfiks/shared';
import { errorMessage } from '../../errors';
import { uploadImage, type PickedImage } from '../../images';
import { useT } from '../../i18n';
import { useAuth, useRuntime } from '../../runtime';
import { spacing } from '../../theme/tokens';
import { Avatar } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { Header, Screen } from '../../ui/Screen';
import { AppText } from '../../ui/Text';
import { TextField } from '../../ui/TextField';
import { useToast } from '../../ui/Toast';

export interface ProfileScreenProps {
  onDone: (me: Me) => void;
  onBack?: () => void;
}

/** First/last name and an optional photo (shown when `me.profileComplete` is false). */
export function ProfileScreen({ onDone, onBack }: ProfileScreenProps) {
  const { t } = useT();
  const runtime = useRuntime();
  const toast = useToast();
  const me = useAuth((s) => s.me);
  const [firstName, setFirstName] = useState(me?.firstName ?? '');
  const [lastName, setLastName] = useState(me?.lastName ?? '');
  const [photo, setPhoto] = useState<PickedImage | null>(null);
  const [errors, setErrors] = useState<{ firstName?: string; lastName?: string; form?: string }>({});
  const [saving, setSaving] = useState(false);

  const pickPhoto = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8 });
      if (!result.canceled && result.assets[0]) {
        const a = result.assets[0];
        setPhoto({ uri: a.uri, mimeType: a.mimeType, fileName: a.fileName, width: a.width, height: a.height });
      }
    } catch {
      toast.show(t('auth.galleryDenied'), { kind: 'error' });
    }
  };

  const save = async () => {
    const f = firstName.trim();
    const l = lastName.trim();
    const next = { firstName: f ? undefined : t('auth.firstNameRequired'), lastName: l ? undefined : t('auth.lastNameRequired') };
    setErrors(next);
    if (next.firstName || next.lastName) return;
    setSaving(true);
    try {
      let photoFileId: string | undefined;
      if (photo) {
        try {
          photoFileId = (await uploadImage(runtime.api, photo, 'PROFILE_PHOTO')).id;
        } catch {
          toast.show(t('auth.photoUploadFailed'), { kind: 'error' });
        }
      }
      const updated = await runtime.api.call(api.me.update, { body: { firstName: f, lastName: l, ...(photoFileId ? { photoFileId } : {}) } });
      runtime.auth.getState().setMe(updated);
      onDone(updated);
    } catch (err) {
      setErrors({ form: errorMessage(t, err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen
      scroll
      testID="profile-screen"
      footer={<Button title={t('common:actions.continue')} onPress={() => void save()} loading={saving} testID="profile-save" />}
    >
      <Header onBack={onBack} title={t('auth.profileTitle')} subtitle={t('auth.profileSubtitle')} />
      <Pressable onPress={() => void pickPhoto()} style={styles.photo} accessibilityRole="button" testID="profile-photo">
        <Avatar uri={photo?.uri ?? me?.photo?.url} firstName={firstName} lastName={lastName} size={88} />
        <View style={styles.photoText}>
          <AppText variant="bodyStrong" color="primary">
            {photo || me?.photo ? t('auth.changePhoto') : t('auth.addPhoto')}
          </AppText>
          <AppText variant="caption" color="textMuted">
            {t('auth.photoOptional')}
          </AppText>
        </View>
      </Pressable>
      <TextField
        label={t('common:fields.firstName')}
        value={firstName}
        onChangeText={setFirstName}
        error={errors.firstName}
        autoCapitalize="words"
        autoComplete="given-name"
        maxLength={60}
        testID="profile-first-name"
      />
      <TextField
        label={t('common:fields.lastName')}
        value={lastName}
        onChangeText={setLastName}
        error={errors.lastName}
        autoCapitalize="words"
        autoComplete="family-name"
        maxLength={60}
        testID="profile-last-name"
      />
      {errors.form ? (
        <AppText variant="small" color="danger" testID="profile-error">
          {errors.form}
        </AppText>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  photo: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xl },
  photoText: { marginLeft: spacing.lg },
});
