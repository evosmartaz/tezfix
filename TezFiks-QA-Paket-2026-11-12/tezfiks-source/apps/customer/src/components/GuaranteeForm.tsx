import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { formatDate } from '@tezfiks/shared';
import { AppText, Banner, Button, TextField, spacing, useT, useToast } from '@tezfiks/mobile';
import { PhotoPicker, isUploading, uploadedIds, type PhotoItem } from './PhotoPicker';

export const GUARANTEE_MIN = 5;
export const GUARANTEE_MAX = 2000;
export const GUARANTEE_PHOTOS = 5;

export interface GuaranteeFormProps {
  until: string | null;
  submitting?: boolean;
  error?: string | null;
  onSubmit: (body: { description: string; photoFileIds: string[] }) => void;
  testID?: string;
}

/** TezFiks Zəmanəti claim (spec 4.6): what went wrong, with up to 5 photos uploaded as CASE_PHOTO. */
export function GuaranteeForm({ until, submitting, error, onSubmit, testID = 'guarantee-form' }: GuaranteeFormProps) {
  const { t } = useT();
  const toast = useToast();
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const submit = () => {
    if (isUploading(photos)) {
      toast.show(t('photos.waitUpload'));
      return;
    }
    const text = description.trim();
    if (text.length < GUARANTEE_MIN) {
      setProblem(t('guarantee.tooShort'));
      return;
    }
    setProblem(null);
    onSubmit({ description: text, photoFileIds: uploadedIds(photos) });
  };
  return (
    <View testID={testID}>
      <AppText variant="body" style={styles.block}>
        {t('guarantee.text')}
      </AppText>
      {until ? <Banner tone="success" message={t('guarantee.until', { date: formatDate(until) })} testID={`${testID}-until`} /> : null}
      <TextField
        label={t('guarantee.descriptionLabel')}
        placeholder={t('guarantee.descriptionPlaceholder')}
        value={description}
        onChangeText={(v) => {
          setDescription(v);
          setProblem(null);
        }}
        multiline
        maxLength={GUARANTEE_MAX}
        error={problem ?? error ?? null}
        testID={`${testID}-description`}
      />
      <AppText variant="bodyStrong" style={styles.label}>
        {t('photos.title')}
      </AppText>
      <PhotoPicker items={photos} onChange={setPhotos} max={GUARANTEE_PHOTOS} kind="CASE_PHOTO" />
      <Button title={t('guarantee.submit')} onPress={submit} loading={submitting} disabled={isUploading(photos)} style={styles.submit} testID={`${testID}-submit`} />
    </View>
  );
}

const styles = StyleSheet.create({
  block: { marginBottom: spacing.md },
  label: { marginTop: spacing.sm, marginBottom: spacing.xs },
  submit: { marginTop: spacing.lg },
});
