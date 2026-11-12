import React, { useReducer, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@tezfiks/shared';
import {
  AppText,
  Badge,
  Banner,
  Button,
  Card,
  Header,
  ListItem,
  LoadingState,
  Screen,
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
import { KycCamera } from '../components/KycCamera';
import { VerificationCard } from '../components/VerificationCard';
import { qk, useRefreshMe } from '../hooks/queries';
import {
  buildKycSubmitBody,
  canSubmit,
  extrasFileKind,
  initialKycState,
  kycReducer,
  KYC_MAX_EXTRAS,
  KYC_SLOTS,
  KYC_STEPS,
  SLOT_FILE_KIND,
  type KycSlot,
  type UploadStatus,
} from '../lib/kyc';

const STATUS_TONE: Record<UploadStatus, 'success' | 'warning' | 'danger'> = { uploaded: 'success', uploading: 'warning', failed: 'danger' };

/**
 * KYC (board 03 A): consent → ID front → ID back (card frame) → guided selfie (look / turn head / blink, front camera)
 * → optional documents → review → POST /kyc/submissions. Each photo is uploaded as soon as it is confirmed.
 */
export default function KycFlow() {
  const { t, locale } = useT();
  const client = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const refreshMe = useRefreshMe();
  const params = useLocalSearchParams<{ subject?: string; companyId?: string }>();
  const subject = params.subject === 'COMPANY' ? 'COMPANY' : 'HANDYMAN';
  const companyId = subject === 'COMPANY' && typeof params.companyId === 'string' ? params.companyId : null;
  const [state, dispatch] = useReducer(kycReducer, initialKycState(subject, companyId));

  const status = useQuery({
    queryKey: qk.kycStatus(companyId),
    queryFn: () => client.call(api.kyc.status, { query: companyId ? { companyId } : {} }),
  });

  const upload = async (slot: KycSlot, image: PickedImage) => {
    dispatch({ type: 'captured', slot, uri: image.uri });
    try {
      const ref = await uploadImage(client, image, SLOT_FILE_KIND[slot]);
      dispatch({ type: 'uploaded', slot, uri: image.uri, fileId: ref.id });
    } catch {
      dispatch({ type: 'uploadFailed', slot, uri: image.uri });
      toast.show(t('kyc.uploadFailed'), { kind: 'error' });
    }
  };

  const addExtra = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 });
    const a = !res.canceled ? res.assets?.[0] : undefined;
    if (!a?.uri) return;
    dispatch({ type: 'extraAdded', uri: a.uri });
    try {
      const ref = await uploadImage(client, { uri: a.uri, width: a.width, height: a.height, mimeType: a.mimeType, fileName: a.fileName }, extrasFileKind(subject));
      dispatch({ type: 'extraUploaded', uri: a.uri, fileId: ref.id });
    } catch {
      dispatch({ type: 'extraFailed', uri: a.uri });
      toast.show(t('kyc.uploadFailed'), { kind: 'error' });
    }
  };

  // Two taps in the same frame both see the pre-submit state: a ref makes the submission single-flight (each
  // POST /kyc/submissions counts toward the 24 h attempt limit and the endpoint is not idempotent).
  const submitting = useRef(false);
  const submit = async () => {
    if (submitting.current) return;
    const body = buildKycSubmitBody(state, locale);
    if (!body) return;
    submitting.current = true;
    dispatch({ type: 'submitStart' });
    try {
      await client.call(api.kyc.submit, { body });
      dispatch({ type: 'submitted' });
      void queryClient.invalidateQueries({ queryKey: ['kyc'] });
      void queryClient.invalidateQueries({ queryKey: qk.profile });
      await refreshMe().catch(() => undefined);
      router.replace({ pathname: '/verification', params: companyId ? { companyId } : {} } as never);
    } catch (err) {
      dispatch({ type: 'submitFailed', error: (err as { code?: string })?.code ?? 'INTERNAL' });
      toast.show(errorMessage(t, err), { kind: 'error' });
    } finally {
      submitting.current = false;
    }
  };

  const back = () => {
    if (state.step === 'consent' || state.submitting) {
      if (router.canGoBack()) router.back();
      else router.replace('/');
    } else dispatch({ type: 'back' });
  };

  const stepNo = KYC_STEPS.indexOf(state.step) + 1;
  const header = (
    <Header
      title={t(subject === 'COMPANY' ? 'kyc.titleCompany' : 'kyc.title')}
      subtitle={t('kyc.step', { current: stepNo, total: KYC_STEPS.length })}
      onBack={back}
    />
  );

  // Already sent or decided: show the state instead of the flow.
  const s = status.data;
  if (status.isLoading) {
    return (
      <Screen testID="kyc-screen">
        {header}
        <LoadingState />
      </Screen>
    );
  }
  if (s && (s.status === 'PENDING_REVIEW' || s.status === 'APPROVED' || s.status === 'BLOCKED') && !state.submitted) {
    return (
      <Screen testID="kyc-screen" footer={<Button variant="outline" title={t('common:actions.back')} onPress={() => router.replace('/')} testID="kyc-home" />}>
        {header}
        {s.status === 'APPROVED' ? (
          <Banner tone="success" message={t('verification.approved')} testID="kyc-approved" />
        ) : (
          <VerificationCard status={s.status} subject={subject} />
        )}
      </Screen>
    );
  }
  if (s && s.attemptsLeft24h <= 0) {
    return (
      <Screen testID="kyc-screen">
        {header}
        <Banner tone="danger" message={t('verification.limitReached')} testID="kyc-limit" />
      </Screen>
    );
  }

  if (state.step === 'consent') {
    return (
      <Screen
        scroll
        testID="kyc-screen"
        footer={<Button title={t('kyc.agree')} onPress={() => dispatch({ type: 'acceptConsent' })} testID="kyc-consent-accept" />}
      >
        {header}
        <AppText variant="h3">{t('kyc.consentTitle')}</AppText>
        <AppText variant="body" style={styles.consent} testID="kyc-consent-text">
          {t('kyc.consentText')}
        </AppText>
        <Card style={styles.steps}>
          {(['kyc.stepsId', 'kyc.stepsSelfie', 'kyc.stepsReview'] as const).map((k) => (
            <View key={k} style={styles.stepRow}>
              <Ionicons name="checkmark-circle" size={18} color={colors.primary} />
              <AppText variant="small" style={styles.stepText}>
                {t(k)}
              </AppText>
            </View>
          ))}
        </Card>
      </Screen>
    );
  }

  if ((KYC_SLOTS as readonly string[]).includes(state.step)) {
    const slot = state.step as KycSlot;
    return (
      <Screen scroll testID="kyc-screen">
        {header}
        <KycCamera slot={slot} title={t(`kyc.slot.${slot}.title`)} instruction={t(`kyc.slot.${slot}.instruction`)} onCaptured={(img) => void upload(slot, img)} />
      </Screen>
    );
  }

  if (state.step === 'extras') {
    return (
      <Screen
        scroll
        testID="kyc-screen"
        footer={<Button title={t('common:actions.next')} onPress={() => dispatch({ type: 'next' })} testID="kyc-extras-next" />}
      >
        {header}
        <AppText variant="h3">{t(subject === 'COMPANY' ? 'kyc.extrasTitleCompany' : 'kyc.extrasTitle')}</AppText>
        <AppText variant="small" color="textMuted" style={styles.consent}>
          {t('kyc.extrasHint', { max: KYC_MAX_EXTRAS })}
        </AppText>
        {state.extras.map((e, i) => (
          <ListItem
            key={e.uri}
            title={t('kyc.extraItem', { n: i + 1 })}
            right={
              <View style={styles.extraRight}>
                <Badge label={t(`kyc.upload.${e.status}`)} tone={STATUS_TONE[e.status]} />
                <Pressable onPress={() => dispatch({ type: 'extraRemoved', uri: e.uri })} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('common:actions.delete')}>
                  <Ionicons name="trash-outline" size={20} color={colors.danger} />
                </Pressable>
              </View>
            }
          />
        ))}
        {state.extras.length < KYC_MAX_EXTRAS ? (
          <Button variant="secondary" title={t('kyc.addDocument')} onPress={() => void addExtra()} testID="kyc-add-extra" />
        ) : null}
      </Screen>
    );
  }

  // review
  return (
    <Screen
      scroll
      testID="kyc-screen"
      footer={<Button title={t('kyc.submit')} onPress={() => void submit()} loading={state.submitting} disabled={!canSubmit(state)} testID="kyc-submit" />}
    >
      {header}
      <AppText variant="h3">{t('kyc.reviewTitle')}</AppText>
      {KYC_SLOTS.map((slot) => {
        const c = state.captures[slot];
        const st: UploadStatus = c?.status ?? 'failed';
        return (
          <ListItem
            key={slot}
            title={t(`kyc.slot.${slot}.title`)}
            testID={`kyc-review-${slot}`}
            right={
              <View style={styles.extraRight}>
                <Badge label={t(`kyc.upload.${st}`)} tone={STATUS_TONE[st]} />
                <Pressable onPress={() => dispatch({ type: 'retake', slot })} hitSlop={8} accessibilityRole="button" testID={`kyc-retake-${slot}`}>
                  <AppText variant="small" color="primary">
                    {t('kyc.retake')}
                  </AppText>
                </Pressable>
              </View>
            }
          />
        );
      })}
      {state.extras.length ? (
        <AppText variant="small" color="textMuted" style={styles.consent}>
          {t('kyc.extrasCount', { count: state.extras.filter((e) => e.status === 'uploaded').length })}
        </AppText>
      ) : null}
      {s ? (
        <AppText variant="caption" color="textMuted" style={styles.consent}>
          {t('verification.attemptsLeft', { count: s.attemptsLeft24h })}
        </AppText>
      ) : null}
      {state.error ? <Banner tone="danger" message={t(`common:errors.${state.error}`)} testID="kyc-error" /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  consent: { marginTop: spacing.sm, marginBottom: spacing.md },
  steps: { marginTop: spacing.md, borderRadius: radii.lg },
  stepRow: { flexDirection: 'row', alignItems: 'center', marginVertical: spacing.xs },
  stepText: { marginLeft: spacing.sm, flex: 1 },
  extraRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
