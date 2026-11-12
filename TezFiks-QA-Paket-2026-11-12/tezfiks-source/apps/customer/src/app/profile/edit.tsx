import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { api } from '@tezfiks/shared';
import { AppText, Avatar, Button, Header, Screen, TextField, errorMessage, spacing, uploadImage, useAuth, useRuntime, useT, useToast, type PickedImage } from '@tezfiks/mobile';
import { toPicked } from '../../components/PhotoPicker';
import { NAME_MAX, profilePatch, validateNames, type NameErrors } from '../../lib/profile';

/** Edit first/last name and the profile photo (PATCH /me, photo uploaded as PROFILE_PHOTO). */
export default function ProfileEditRoute() {
  const { t } = useT();
  const runtime = useRuntime();
  const toast = useToast();
  const me = useAuth((s) => s.me);
  const [firstName, setFirstName] = useState(me?.firstName ?? '');
  const [lastName, setLastName] = useState(me?.lastName ?? '');
  const [photo, setPhoto] = useState<PickedImage | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [errors, setErrors] = useState<NameErrors>({});
  const [saving, setSaving] = useState(false);
  const back = () => (router.canGoBack() ? router.back() : router.replace('/profile'));

  const pick = async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8 });
      if (!res.canceled && res.assets?.[0]) {
        setPhoto(toPicked(res.assets[0]));
        setRemovePhoto(false);
      }
    } catch {
      toast.show(t('photos.pickFailed'), { kind: 'error' });
    }
  };

  const save = async () => {
    const e = validateNames(firstName, lastName);
    setErrors(e);
    if (e.firstName || e.lastName) return;
    setSaving(true);
    try {
      let photoFileId: string | null | undefined;
      if (photo) photoFileId = (await uploadImage(runtime.api, photo, 'PROFILE_PHOTO')).id;
      else if (removePhoto) photoFileId = null;
      const body = profilePatch({ firstName: me?.firstName ?? null, lastName: me?.lastName ?? null }, { firstName, lastName, photoFileId });
      if (body) {
        const updated = await runtime.api.call(api.me.update, { body });
        runtime.auth.getState().setMe(updated);
      }
      toast.show(t('profile.saved'), { kind: 'success' });
      back();
    } catch (err) {
      toast.show(errorMessage(t, err), { kind: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const shownPhoto = removePhoto ? null : photo?.uri ?? me?.photo?.url ?? null;

  return (
    <Screen scroll edges={['top', 'bottom']} testID="profile-edit-screen" footer={<Button title={t('common:actions.save')} onPress={() => void save()} loading={saving} testID="profile-save" />}>
      <Header title={t('profile.editTitle')} onBack={back} />
      <Pressable onPress={() => void pick()} style={styles.photo} accessibilityRole="button" testID="profile-edit-photo">
        <Avatar uri={shownPhoto} firstName={firstName} lastName={lastName} size={88} />
        <View style={styles.photoText}>
          <AppText variant="bodyStrong" color="primary">
            {shownPhoto ? t('auth.changePhoto') : t('auth.addPhoto')}
          </AppText>
        </View>
      </Pressable>
      {shownPhoto ? (
        <Button variant="ghost" size="sm" fullWidth={false} title={t('profile.removePhoto')} onPress={() => { setPhoto(null); setRemovePhoto(true); }} testID="profile-remove-photo" />
      ) : null}
      <TextField label={t('common:fields.firstName')} value={firstName} onChangeText={setFirstName} maxLength={NAME_MAX} error={errors.firstName ? t(errors.firstName) : null} testID="profile-first-name" />
      <TextField label={t('common:fields.lastName')} value={lastName} onChangeText={setLastName} maxLength={NAME_MAX} error={errors.lastName ? t(errors.lastName) : null} testID="profile-last-name" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  photo: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  photoText: { marginLeft: spacing.lg },
});
