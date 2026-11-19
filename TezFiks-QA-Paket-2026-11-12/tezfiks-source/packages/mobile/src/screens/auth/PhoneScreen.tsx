import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@tezfiks/shared';
import { otpFlowStore } from '../../auth/flow';
import { errorMessage } from '../../errors';
import { azDigitsToE164, sanitizeAzPhoneDigits } from '../../format';
import { useT } from '../../i18n';
import { useRuntime } from '../../runtime';
import { colors, radii, spacing } from '../../theme/tokens';
import { Button } from '../../ui/Button';
import { LanguagePicker } from '../../ui/LanguagePicker';
import { PhoneInput } from '../../ui/PhoneInput';
import { Screen } from '../../ui/Screen';
import { AppText } from '../../ui/Text';

export interface PhoneScreenProps {
  /** Called after the code was requested; navigate to the OTP screen. */
  onCodeSent: () => void;
  /** Brand line under the logo; defaults to the app name from the app namespace. */
  brand?: string;
}

/** Board 02 A1: dark welcome with the +994 phone field and "Davam et". */
export function PhoneScreen({ onCodeSent, brand }: PhoneScreenProps) {
  const { t, locale } = useT();
  const runtime = useRuntime();
  const [digits, setDigits] = useState(() => sanitizeAzPhoneDigits(otpFlowStore.getState().challenge?.phone ?? ''));
  const [e164, setE164] = useState<string | null>(() => azDigitsToE164(digits));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!e164 || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await runtime.api.call(api.auth.otpRequest, { body: { phone: e164, app: runtime.app, locale } });
      otpFlowStore.getState().setChallenge(res);
      onCodeSent();
    } catch (err) {
      setError(errorMessage(t, err));
    } finally {
      setLoading(false);
    }
  };

  if (runtime.app === 'CUSTOMER') {
    const copy = {
      az: {
        hero: 'Lazım olan anda usta',
        description: 'Ev və avto üçün yoxlanılmış ustalar — bir neçə dəqiqəyə qapınızda.',
        verified: 'Sənədləri yoxlanılmış ustalar',
        wait: 'Orta gözləmə 1–3 dəqiqə',
        payment: 'Nağd və ya kartla — kartda TezFiks Zəmanəti',
      },
      ru: {
        hero: 'Мастер, когда нужен',
        description: 'Проверенные мастера для дома и автомобиля.',
        verified: 'Мастера с проверенными документами',
        wait: 'Среднее ожидание 1–3 минуты',
        payment: 'Наличными или картой — гарантия TezFiks при оплате картой',
      },
      en: {
        hero: 'A handyman when you need one',
        description: 'Verified professionals for your home and car.',
        verified: 'Document-verified professionals',
        wait: 'Average wait 1–3 minutes',
        payment: 'Cash or card — TezFiks Guarantee with card payments',
      },
    }[locale] ?? {
      hero: 'Lazım olan anda usta',
      description: 'Ev və avto üçün yoxlanılmış ustalar — bir neçə dəqiqəyə qapınızda.',
      verified: 'Sənədləri yoxlanılmış ustalar',
      wait: 'Orta gözləmə 1–3 dəqiqə',
      payment: 'Nağd və ya kartla — kartda TezFiks Zəmanəti',
    };
    return (
      <Screen
        scroll
        testID="phone-screen"
        style={styles.customerScreen}
        contentStyle={styles.customerContent}
        footer={
          <View style={styles.customerFooter}>
            <AppText variant="bodyStrong" style={styles.customerPhoneLabel}>
              {t('common:fields.phone')}
            </AppText>
            <PhoneInput
              value={digits}
              onChange={(d, normalized) => {
                setDigits(d);
                setE164(normalized);
                if (error) setError(null);
              }}
              error={error}
              onSubmitEditing={() => void submit()}
              accessibilityLabel={t('common:fields.phone')}
            />
            <Button title={t('common:actions.continue')} size="lg" onPress={() => void submit()} disabled={!e164} loading={loading} testID="phone-continue" />
            <AppText variant="caption" color="textMuted" align="center" style={styles.terms}>
              {t('auth.terms')}
            </AppText>
            <AppText variant="caption" color="textMuted" align="center" style={styles.customerDeliveryHint} testID="phone-whatsapp-hint">
              {t('common:login.codeViaWhatsApp')}
            </AppText>
          </View>
        }
      >
        <View style={styles.top}><LanguagePicker /></View>
        <View style={styles.customerLogo}>
          <View style={styles.customerMark}><Ionicons name="flash" size={26} color={colors.surface} /></View>
          <AppText variant="h1">{brand ?? t('appName')}</AppText>
        </View>
        <View style={styles.customerHero} testID="phone-hero">
          <AppText variant="display">{copy.hero}</AppText>
          <AppText variant="body" color="textMuted" style={styles.customerDescription}>{copy.description}</AppText>
        </View>
        <View style={styles.customerBenefits}>
          {([
            { icon: 'shield-checkmark-outline' as const, label: copy.verified },
            { icon: 'time-outline' as const, label: copy.wait },
            { icon: 'wallet-outline' as const, label: copy.payment },
          ]).map(({ icon, label }) => (
            <View key={icon} style={styles.customerBenefitRow}>
              <View style={styles.customerBenefitIcon}><Ionicons name={icon} size={18} color={colors.primary} /></View>
              <AppText variant="bodyStrong" style={styles.customerBenefitText}>{label}</AppText>
            </View>
          ))}
        </View>
      </Screen>
    );
  }

  return (
    <Screen dark scroll testID="phone-screen">
      <View style={styles.top}>
        <LanguagePicker dark />
      </View>
      <View style={styles.hero} testID="phone-hero">
        <AppText variant="display" color="textInverse">
          {brand ?? t('appName')}
        </AppText>
        <AppText variant="body" color="primary" style={styles.tagline}>
          {t('common:brand.tagline')}
        </AppText>
      </View>
      <View style={styles.form}>
        <AppText variant="h3" color="textInverse" style={styles.title}>
          {t('auth.welcomeTitle')}
        </AppText>
        <AppText variant="small" color="textInverseMuted" style={styles.hint} testID="phone-whatsapp-hint">
          {t('common:login.codeViaWhatsApp')}
        </AppText>
        <PhoneInput
          dark
          value={digits}
          onChange={(d, normalized) => {
            setDigits(d);
            setE164(normalized);
            if (error) setError(null);
          }}
          error={error}
          onSubmitEditing={() => void submit()}
          accessibilityLabel={t('common:fields.phone')}
        />
        <Button title={t('common:actions.continue')} onPress={() => void submit()} disabled={!e164} loading={loading} testID="phone-continue" />
        <AppText variant="caption" color="textInverseMuted" align="center" style={styles.terms}>
          {t('auth.terms')}
        </AppText>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', justifyContent: 'flex-end' },
  // Grows into the free space on tall screens; on a 360x640 dp phone with the keyboard open it gives way so the title,
  // the phone field and "Davam et" stay above the keyboard.
  hero: { flex: 1, justifyContent: 'center', paddingVertical: spacing.lg, minHeight: 80 },
  tagline: { marginTop: spacing.sm, color: colors.primary },
  form: { paddingBottom: spacing.xl },
  title: { marginBottom: spacing.xs },
  hint: { marginBottom: spacing.md },
  terms: { marginTop: spacing.md },
  customerScreen: { backgroundColor: colors.surface },
  customerContent: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.xl },
  customerLogo: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: 40 },
  customerMark: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
  customerHero: { marginTop: spacing.xl, gap: spacing.sm },
  customerDescription: { marginTop: spacing.xs },
  customerBenefits: { marginTop: spacing.xl, backgroundColor: colors.background, borderRadius: radii.lg, padding: spacing.lg, gap: 14 },
  customerBenefitRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  customerBenefitIcon: { height: 34, width: 34, borderRadius: 10, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  customerBenefitText: { flex: 1 },
  customerPhoneLabel: { marginBottom: spacing.sm },
  customerFooter: { backgroundColor: colors.surface },
  customerDeliveryHint: { marginTop: spacing.sm },
});
