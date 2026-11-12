import React, { useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@tezfiks/shared';
import { AppText, Button, Header, Screen, TextField, colors, errorMessage, radii, spacing, uploadImage, useApi, useT, useToast } from '@tezfiks/mobile';
import { qk } from '../../../hooks/queries';
import { stepProgress, validateReportForm } from '../../../lib/projects';

/** Daily status report of an awarded project: note, progress %, up to 5 photos (REPORT_PHOTO uploads). */
export default function ProjectReport() {
  const { t } = useT();
  const client = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ id: string; companyId?: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const companyId = typeof params.companyId === 'string' && params.companyId ? params.companyId : null;
  const [note, setNote] = useState('');
  const [progress, setProgress] = useState(50);
  const [photos, setPhotos] = useState<Array<{ id: string; url: string }>>([]);
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState<{ note?: string; progress?: string; photos?: string }>({});
  const [busy, setBusy] = useState(false);

  const back = () => (router.canGoBack() ? router.back() : router.replace(`/projects/${id}` as never));

  const addPhoto = async () => {
    if (photos.length >= 5) return;
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    const a = !res.canceled ? res.assets?.[0] : undefined;
    if (!a?.uri) return;
    setUploading(true);
    try {
      const ref = await uploadImage(client, { uri: a.uri, width: a.width, height: a.height, mimeType: a.mimeType, fileName: a.fileName }, 'REPORT_PHOTO');
      setPhotos((p) => [...p, { id: ref.id, url: ref.url }]);
    } catch (err) {
      toast.show(errorMessage(t, err), { kind: 'error' });
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    const v = validateReportForm({ note, progress, photoIds: photos.map((p) => p.id) });
    if (!v.body) {
      setErrors(Object.fromEntries(Object.entries(v.errors).map(([k, e]) => [k, t(`projects.report.errors.${e}`)])));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await client.call(api.providerProjects.addReport, { params: { id }, body: { ...v.body, ...(companyId ? { companyId } : {}) } });
      toast.show(t('projects.report.sent'), { kind: 'success' });
      void queryClient.invalidateQueries({ queryKey: qk.project(id, companyId) });
      back();
    } catch (err) {
      toast.show(errorMessage(t, err), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll testID="report-screen" footer={<Button title={t('projects.report.submit')} onPress={() => void submit()} loading={busy} disabled={uploading} testID="report-submit" />}>
      <Header title={t('projects.report.title')} onBack={back} />
      <TextField label={t('projects.report.note')} value={note} onChangeText={setNote} multiline maxLength={2000} error={errors.note} testID="report-note" />
      <View style={styles.progressRow}>
        <Pressable onPress={() => setProgress((p) => stepProgress(p, -5))} style={styles.step} accessibilityRole="button" testID="report-progress-minus">
          <Ionicons name="remove" size={22} color={colors.text} />
        </Pressable>
        <AppText variant="h3" style={styles.progressText} testID="report-progress">
          {t('projects.report.progress', { percent: progress })}
        </AppText>
        <Pressable onPress={() => setProgress((p) => stepProgress(p, 5))} style={styles.step} accessibilityRole="button" testID="report-progress-plus">
          <Ionicons name="add" size={22} color={colors.text} />
        </Pressable>
      </View>
      <AppText variant="bodyStrong" style={styles.label}>
        {t('projects.report.photos', { count: photos.length })}
      </AppText>
      <View style={styles.photos}>
        {photos.map((p) => (
          <Image key={p.id} source={{ uri: p.url }} style={styles.photo} />
        ))}
        {photos.length < 5 ? (
          <Pressable onPress={() => void addPhoto()} style={[styles.photo, styles.add]} accessibilityRole="button" accessibilityLabel={t('projects.report.addPhoto')} testID="report-add-photo">
            <Ionicons name={uploading ? 'hourglass-outline' : 'camera-outline'} size={24} color={colors.primary} />
          </Pressable>
        ) : null}
      </View>
      {errors.photos ? (
        <AppText variant="small" color="danger">
          {errors.photos}
        </AppText>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  progressRow: { flexDirection: 'row', alignItems: 'center', marginVertical: spacing.md },
  progressText: { flex: 1, textAlign: 'center' },
  step: { width: 44, height: 44, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  label: { marginBottom: spacing.sm },
  photos: { flexDirection: 'row', flexWrap: 'wrap' },
  photo: { width: 80, height: 80, borderRadius: radii.md, marginRight: spacing.sm, marginBottom: spacing.sm, backgroundColor: colors.border },
  add: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderStyle: 'dashed', borderColor: colors.primary, backgroundColor: colors.primarySoft },
});
