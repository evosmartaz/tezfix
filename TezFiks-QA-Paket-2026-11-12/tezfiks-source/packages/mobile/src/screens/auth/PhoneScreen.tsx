import React, { useState, type ComponentProps } from 'react';
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
  /** Brand name next to the logo; defaults to the app name from the app namespace. */
  brand?: string;
}

const FEATURES: { key: 'feature1' | 'feature2' | 'feature3'; icon: ComponentProps<typeof Ionicons>['name'] }[] = [
  { key: 'feature1', icon: 'shield-checkmark-outline' },
  { key: 'feature2', icon: 'time-outline' },
  { key: 'feature3', icon: 'wallet-outline' },
];

/** Board A1 (v2, UX-C19 one light theme): logo, headline, three promises, then the +994 phone field and "Davam et". */
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

  return (
    <Screen scroll testID="phone-screen">
      <View style={styles.top}>
        <View style={styles.logoRow}>
          <View style={styles.logo}>
            <Ionicons name="flash-outline" size={22} color={colors.textInverse} />
          </View>
          <AppText variant="h2" style={styles.brand}>
            {brand ?? t('appName')}
          </AppText>
        </View>
        <LanguagePicker />
      </View>
      <View style={styles.hero} testID="phone-hero">
        <AppText variant="numeric" accessibilityRole="header">
          {t('common:brand.tagline')}
        </AppText>
        <AppText variant="body" color="textMuted" style={styles.lead}>
          {t('auth.lead')}
        </AppText>
        <View style={styles.features}>
          {FEATURES.map((f) => (
            <View key={f.key} style={styles.feature}>
              <View style={styles.featureIcon}>
                <Ionicons name={f.icon} size={18} color={colors.primary} />
              </View>
              <AppText variant="bodyStrong" style={styles.featureText}>
                {t(`auth.${f.key}`)}
              </AppText>
            </View>
          ))}
        </View>
      </View>
      <View style={styles.form}>
        <AppText variant="bodyStrong" style={styles.title}>
          {t('auth.welcomeTitle')}
        </AppText>
        <AppText variant="small" color="textMuted" style={styles.hint} testID="phone-whatsapp-hint">
          {t('common:login.codeViaWhatsApp')}
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
        <Button title={t('common:actions.continue')} onPress={() => void submit()} disabled={!e164} loading={loading} testID="phone-continue" />
        <AppText variant="small" color="textMuted" align="center" style={styles.terms}>
          {t('auth.terms')}
        </AppText>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  logoRow: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
  logo: { width: 40, height: 40, borderRadius: radii.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  brand: { marginLeft: spacing.sm, flexShrink: 1 },
  // Grows into the free space on tall screens; on a 360x640 dp phone with the keyboard open it gives way so the title,
  // the phone field and "Davam et" stay above the keyboard.
  hero: { flex: 1, justifyContent: 'center', paddingVertical: spacing.xl, minHeight: 80 },
  lead: { marginTop: spacing.sm },
  features: { marginTop: spacing.xl, backgroundColor: colors.surfaceMuted, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.md },
  feature: { flexDirection: 'row', alignItems: 'center' },
  featureIcon: { width: 32, height: 32, borderRadius: radii.sm, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  featureText: { flex: 1, marginLeft: spacing.md },
  form: { paddingBottom: spacing.xl },
  title: { marginBottom: spacing.xxs },
  hint: { marginBottom: spacing.sm },
  terms: { marginTop: spacing.md },
});
