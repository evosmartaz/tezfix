import React, { useMemo, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { api, type ClassifyPhotoResponse, type Vertical } from '@tezfiks/shared';
import {
  AppText,
  Banner,
  Button,
  Card,
  Header,
  LoadingState,
  Screen,
  TextField,
  colors,
  errorMessage,
  radii,
  spacing,
  uploadImage,
  useApi,
  useT,
  useToast,
  type PickedImage,
} from '@tezfiks/mobile';
import { CategoryBrowser } from '../components/CategoryBrowser';
import { pickImages } from '../components/PhotoPicker';
import { useCategories } from '../data/queries';
import { confidentPick, suggestionsFrom } from '../lib/photoClassify';
import { findCategory } from '../lib/categories';

type Stage = 'pick' | 'working' | 'choose';

/**
 * "Şəkil ilə tap": take or pick a photo → upload (REQUEST_PHOTO) → POST /requests/classify-photo →
 * a confident result opens the request form with the service preselected; otherwise the customer picks
 * from the candidates or the full catalogue. The uploaded photo is attached to the request either way.
 */
export default function FindByPhotoRoute() {
  const { t } = useT();
  const client = useApi();
  const toast = useToast();
  const params = useLocalSearchParams<{ vertical?: string }>();
  const categories = useCategories();
  const [vertical, setVertical] = useState<Vertical>(params.vertical === 'AUTO' ? 'AUTO' : 'HOME');
  const [stage, setStage] = useState<Stage>('pick');
  const [note, setNote] = useState('');
  const [image, setImage] = useState<PickedImage | null>(null);
  const [fileId, setFileId] = useState<string | null>(null);
  const [result, setResult] = useState<ClassifyPhotoResponse | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const suggestions = useMemo(() => suggestionsFrom(result, categories.data ?? []), [result, categories.data]);

  const goToForm = (categoryId: string, photo: { id: string; uri: string }) => {
    router.replace({
      // Quote-only services continue in the business request (board 02 D).
      pathname: findCategory(categories.data, categoryId)?.flow === 'QUOTE' ? '/project/new' : '/request/new',
      params: { categoryId, photoId: photo.id, photoUrl: photo.uri, ...(note.trim() ? { description: note.trim() } : {}) },
    });
  };

  const run = async (source: 'camera' | 'gallery') => {
    setProblem(null);
    let picked: PickedImage[] | 'denied';
    try {
      picked = await pickImages(source, 1);
    } catch {
      toast.show(t('photos.pickFailed'), { kind: 'error' });
      return;
    }
    if (picked === 'denied') {
      toast.show(t('photos.cameraDenied'), { kind: 'error' });
      return;
    }
    const img = picked[0];
    if (!img) return;
    setImage(img);
    setStage('working');
    let id: string;
    try {
      id = (await uploadImage(client, img, 'REQUEST_PHOTO')).id;
      setFileId(id);
    } catch (err) {
      toast.show(errorMessage(t, err), { kind: 'error' });
      setImage(null);
      setStage('pick');
      return;
    }
    try {
      const res = await client.call(api.requests.classifyPhoto, {
        body: { fileId: id, vertical, ...(note.trim() ? { note: note.trim() } : {}) },
      });
      setResult(res);
      // The catalogue may not be loaded yet (slow network, earlier failure): load it before matching the AI's pick.
      const list = categories.data ?? (res.status === 'unavailable' ? [] : ((await categories.refetch()).data ?? []));
      const chosen = confidentPick(res, list);
      if (chosen) {
        goToForm(chosen.id, { id, uri: img.uri });
        return;
      }
      // A classification that worked but cannot be matched to a service is shown like an unsure one (candidates, picker).
      setProblem(res.status === 'unavailable' ? t('common:errors.AI_UNAVAILABLE') : t('photo.unsure'));
    } catch (err) {
      setProblem(errorMessage(t, err));
    }
    setStage('choose');
  };

  return (
    <Screen scroll edges={['top', 'bottom']} testID="find-by-photo-screen">
      <Header title={t('photo.title')} subtitle={t('photo.subtitle')} onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
      {image ? <Image source={{ uri: image.uri }} style={styles.preview} testID="find-by-photo-preview" /> : null}

      {stage === 'pick' ? (
        <View testID="find-by-photo-pick">
          <TextField
            label={t('photo.noteLabel')}
            placeholder={t('photo.notePlaceholder')}
            value={note}
            onChangeText={setNote}
            maxLength={300}
            testID="find-by-photo-note"
          />
          <Button title={t('common:actions.takePhoto')} onPress={() => void run('camera')} testID="find-by-photo-camera" />
          <View style={styles.gap} />
          <Button variant="outline" title={t('common:actions.chooseFromGallery')} onPress={() => void run('gallery')} testID="find-by-photo-gallery" />
          <AppText variant="caption" color="textMuted" align="center" style={styles.hint}>
            {t('photo.privacy')}
          </AppText>
        </View>
      ) : null}

      {stage === 'working' ? (
        <Card style={styles.working} testID="find-by-photo-working">
          <LoadingState />
          <AppText variant="bodyStrong" align="center">
            {t('photo.analyzing')}
          </AppText>
        </Card>
      ) : null}

      {stage === 'choose' && fileId && image ? (
        <View testID="find-by-photo-choose">
          {problem ? <Banner tone="info" message={problem} testID="find-by-photo-problem" /> : null}
          <CategoryBrowser
            categories={categories.data ?? []}
            query={query}
            onQueryChange={setQuery}
            vertical={vertical}
            onVerticalChange={setVertical}
            suggestions={suggestions}
            onSelect={(c) => goToForm(c.id, { id: fileId, uri: image.uri })}
          />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  preview: { width: '100%', height: 200, borderRadius: radii.lg, marginBottom: spacing.lg, backgroundColor: colors.border },
  gap: { height: spacing.sm },
  hint: { marginTop: spacing.md },
  working: { alignItems: 'center', paddingVertical: spacing.xl },
});
