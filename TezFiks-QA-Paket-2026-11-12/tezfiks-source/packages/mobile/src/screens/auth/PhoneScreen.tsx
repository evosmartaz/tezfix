import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { api } from '@tezfiks/shared';
import { otpFlowStore } from '../../auth/flow';
import { errorMessage } from '../../errors';
import { azDigitsToE164, sanitizeAzPhoneDigits } from '../../format';
import { useT } from '../../i18n';
import { useRuntime } from '../../runtime';
import { colors, spacing } from '../../theme/tokens';
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
});
