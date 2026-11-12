import React, { useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { CameraView } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import {
  AppText,
  Button,
  colors,
  ensureCameraPermission,
  openAppSettings,
  radii,
  spacing,
  useT,
  type PermissionResult,
  type PickedImage,
} from '@tezfiks/mobile';
import { slotCamera, type KycSlot } from '../lib/kyc';

export interface KycCameraProps {
  slot: KycSlot;
  title: string;
  instruction: string;
  onCaptured: (image: PickedImage) => void;
}

/**
 * Camera step of the KYC flow: back camera with an ID-card frame for the document sides, front camera with a face
 * oval for the guided selfie (look / turn head / blink). Shows the shot for confirmation before it is used.
 */
export function KycCamera({ slot, title, instruction, onCaptured }: KycCameraProps) {
  const { t } = useT();
  const cfg = slotCamera(slot);
  const camRef = useRef<CameraView>(null);
  const [perm, setPerm] = useState<PermissionResult | 'checking'>('checking');
  const [shot, setShot] = useState<PickedImage | null>(null);
  const [capturing, setCapturing] = useState(false);

  const ask = async () => setPerm(await ensureCameraPermission());
  useEffect(() => {
    void ask();
  }, []);
  useEffect(() => {
    setShot(null);
  }, [slot]);

  const capture = async () => {
    if (!camRef.current || capturing) return;
    setCapturing(true);
    try {
      const pic = await camRef.current.takePictureAsync({ quality: 0.85 });
      if (pic?.uri) setShot({ uri: pic.uri, width: pic.width, height: pic.height, mimeType: 'image/jpeg', fileName: `${slot}.jpg` });
    } catch {
      // the user can try again
    } finally {
      setCapturing(false);
    }
  };

  /** Documents may come from the gallery when the camera is unavailable; selfies never do. */
  const pickDocument = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 });
    const a = !res.canceled ? res.assets?.[0] : undefined;
    if (a?.uri) setShot({ uri: a.uri, width: a.width, height: a.height, mimeType: a.mimeType ?? 'image/jpeg', fileName: a.fileName ?? `${slot}.jpg` });
  };

  return (
    <View style={styles.wrap} testID={`kyc-camera-${slot}`}>
      <AppText variant="h2">{title}</AppText>
      <AppText variant="body" color="textMuted" style={styles.instruction} testID="kyc-instruction">
        {instruction}
      </AppText>
      <View style={styles.viewport}>
        {shot ? (
          <Image source={{ uri: shot.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" testID="kyc-preview" />
        ) : perm === 'granted' ? (
          <>
            <CameraView
              key={`${slot}-${cfg.facing}`}
              ref={camRef}
              style={StyleSheet.absoluteFill}
              facing={cfg.facing}
              mode="picture"
              mute
              testID="kyc-camera-view"
            />
            <View pointerEvents="none" style={styles.overlay}>
              <View style={cfg.overlay === 'card' ? styles.cardFrame : styles.faceFrame} testID={`kyc-overlay-${cfg.overlay}`} />
            </View>
          </>
        ) : (
          <View style={styles.denied}>
            <AppText variant="body" color="textInverse" align="center">
              {perm === 'checking' ? t('common:states.loading') : t('kyc.cameraDenied')}
            </AppText>
          </View>
        )}
      </View>
      {shot ? (
        <View style={styles.row}>
          <Button variant="outline" title={t('kyc.retake')} onPress={() => setShot(null)} style={styles.half} fullWidth={false} testID="kyc-retake" />
          <Button title={t('kyc.usePhoto')} onPress={() => onCaptured(shot)} style={styles.half} fullWidth={false} testID="kyc-use" />
        </View>
      ) : perm === 'granted' ? (
        <Button title={t('kyc.capture')} onPress={() => void capture()} loading={capturing} testID="kyc-capture" />
      ) : perm === 'checking' ? null : (
        <View>
          <Button
            title={perm === 'blocked' ? t('common:actions.openSettings') : t('kyc.allowCamera')}
            onPress={() => void (perm === 'blocked' ? openAppSettings() : ask())}
            testID="kyc-allow-camera"
          />
          {cfg.overlay === 'card' ? (
            <Button variant="ghost" title={t('common:actions.chooseFromGallery')} onPress={() => void pickDocument()} testID="kyc-gallery" />
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  instruction: { marginTop: spacing.xs, marginBottom: spacing.md },
  viewport: { height: 380, borderRadius: radii.lg, overflow: 'hidden', backgroundColor: colors.dark, marginBottom: spacing.lg },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  cardFrame: { width: '86%', aspectRatio: 1.586, borderRadius: radii.md, borderWidth: 3, borderColor: colors.primary, borderStyle: 'dashed' },
  faceFrame: { width: '62%', aspectRatio: 0.78, borderRadius: 999, borderWidth: 3, borderColor: colors.primary },
  denied: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  row: { flexDirection: 'row' },
  half: { flex: 1, marginHorizontal: spacing.xs },
});
