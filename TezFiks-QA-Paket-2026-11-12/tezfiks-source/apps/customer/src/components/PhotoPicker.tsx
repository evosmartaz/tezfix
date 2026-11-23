import React, { useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import type { FileKind } from '@tezfiks/shared';
import {
  AppText,
  BottomSheet,
  Button,
  colors,
  ensureCameraPermission,
  errorMessage,
  radii,
  spacing,
  uploadImage,
  useApi,
  useT,
  useToast,
  type PickedImage,
} from '@tezfiks/mobile';

export type PhotoStatus = 'uploading' | 'done' | 'error';

export interface PhotoItem {
  key: string;
  uri: string;
  fileId: string | null;
  status: PhotoStatus;
  /** Kept for a retry after a failed upload. */
  source?: PickedImage;
}

let photoSeq = 0;
export function newPhotoKey(): string {
  photoSeq += 1;
  return `p${photoSeq}`;
}

/** Uploaded file ids in the order shown (only finished uploads). */
export function uploadedIds(items: PhotoItem[]): string[] {
  return items.filter((p) => p.status === 'done' && p.fileId).map((p) => p.fileId as string);
}

export function isUploading(items: PhotoItem[]): boolean {
  return items.some((p) => p.status === 'uploading');
}

export function toPicked(a: ImagePicker.ImagePickerAsset): PickedImage {
  return { uri: a.uri, mimeType: a.mimeType, fileName: a.fileName, width: a.width, height: a.height };
}

/** Lets the user take a photo or choose from the gallery (camera permission via expo-camera, no microphone). */
export async function pickImages(source: 'camera' | 'gallery', limit: number): Promise<PickedImage[] | 'denied'> {
  if (limit <= 0) return [];
  if (source === 'camera') {
    const perm = await ensureCameraPermission();
    if (perm !== 'granted') return 'denied';
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9 });
    return res.canceled || !res.assets ? [] : res.assets.slice(0, 1).map(toPicked);
  }
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: limit > 1,
    selectionLimit: limit,
    quality: 0.9,
  });
  return res.canceled || !res.assets ? [] : res.assets.slice(0, limit).map(toPicked);
}

export interface PhotoPickerProps {
  items: PhotoItem[];
  onChange: (update: (prev: PhotoItem[]) => PhotoItem[]) => void;
  max: number;
  /** Upload kind (REQUEST_PHOTO by default; CASE_PHOTO for guarantee claims). */
  kind?: FileKind;
}

/**
 * Up to `max` request photos (board 02 B3 "Foto əlavə et"): each is resized to 1600 px JPEG and uploaded as REQUEST_PHOTO
 * right away, so the request is created with file ids only.
 */
export function PhotoPicker({ items, onChange, max, kind = 'REQUEST_PHOTO' }: PhotoPickerProps) {
  const { t } = useT();
  const client = useApi();
  const toast = useToast();
  const [sheet, setSheet] = useState(false);

  const upload = (item: PhotoItem, image: PickedImage) => {
    onChange((prev) => prev.map((p) => (p.key === item.key ? { ...p, status: 'uploading' } : p)));
    uploadImage(client, image, kind)
      .then((ref) => onChange((prev) => prev.map((p) => (p.key === item.key ? { ...p, fileId: ref.id, status: 'done' } : p))))
      .catch((err) => {
        toast.show(errorMessage(t, err), { kind: 'error' });
        onChange((prev) => prev.map((p) => (p.key === item.key ? { ...p, status: 'error' } : p)));
      });
  };

  const add = async (source: 'camera' | 'gallery') => {
    setSheet(false);
    const remaining = max - items.length;
    try {
      const picked = await pickImages(source, remaining);
      if (picked === 'denied') {
        toast.show(t('photos.cameraDenied'), { kind: 'error' });
        return;
      }
      const created = picked.map((image) => ({ key: newPhotoKey(), uri: image.uri, fileId: null, status: 'uploading' as const, source: image }));
      if (!created.length) return;
      onChange((prev) => [...prev, ...created].slice(0, max));
      for (const c of created) upload(c, c.source);
    } catch {
      toast.show(t('photos.pickFailed'), { kind: 'error' });
    }
  };

  return (
    <View testID="photo-picker">
      <View style={styles.grid}>
        {items.map((p) => (
          <View key={p.key} style={styles.thumb} testID={`photo-${p.key}`}>
            <Image source={{ uri: p.uri }} style={styles.image} />
            {p.status !== 'done' ? (
              <Pressable
                style={styles.overlay}
                onPress={p.status === 'error' && p.source ? () => upload(p, p.source as PickedImage) : undefined}
                accessibilityRole={p.status === 'error' ? 'button' : undefined}
                accessibilityLabel={p.status === 'error' ? t('photos.retry') : t('photos.uploading')}
                testID={`photo-${p.key}-${p.status}`}
              >
                <Ionicons name={p.status === 'error' ? 'refresh' : 'cloud-upload-outline'} size={22} color={colors.textInverse} />
              </Pressable>
            ) : null}
            <Pressable
              style={styles.remove}
              onPress={() => onChange((prev) => prev.filter((x) => x.key !== p.key))}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('photos.remove')}
              testID={`photo-${p.key}-remove`}
            >
              <Ionicons name="close" size={14} color={colors.textInverse} />
            </Pressable>
          </View>
        ))}
        {items.length < max ? (
          <Pressable style={[styles.thumb, styles.add]} onPress={() => setSheet(true)} accessibilityRole="button" testID="photo-add">
            <Ionicons name="camera-outline" size={24} color={colors.primary} />
            <AppText variant="caption" color="primary" align="center">
              {t('photos.add')}
            </AppText>
          </Pressable>
        ) : null}
      </View>
      <AppText variant="caption" color="textMuted">
        {t('photos.limit', { count: items.length, max })}
      </AppText>
      <BottomSheet visible={sheet} onClose={() => setSheet(false)} title={t('photos.add')} testID="photo-source">
        <Button title={t('common:actions.takePhoto')} variant="secondary" onPress={() => void add('camera')} testID="photo-source-camera" />
        <View style={styles.gap} />
        <Button title={t('common:actions.chooseFromGallery')} variant="outline" onPress={() => void add('gallery')} testID="photo-source-gallery" />
      </BottomSheet>
    </View>
  );
}

const SIZE = 76;
const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.xs },
  thumb: { width: SIZE, height: SIZE, borderRadius: radii.md, overflow: 'hidden', backgroundColor: colors.border },
  image: { width: '100%', height: '100%' },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(11,26,92,0.45)', alignItems: 'center', justifyContent: 'center' },
  remove: { position: 'absolute', top: 4, right: 4, backgroundColor: 'rgba(11,26,92,0.7)', borderRadius: 10, padding: 2 },
  add: {
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xs,
  },
  gap: { height: spacing.sm },
});
