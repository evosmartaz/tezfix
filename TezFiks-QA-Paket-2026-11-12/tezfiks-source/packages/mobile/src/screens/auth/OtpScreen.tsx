import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { api, formatPhone, type Me } from '@tezfiks/shared';
import { otpFlowStore, useOtpFlow } from '../../auth/flow';
import { errorCodeOf, errorMessage } from '../../errors';
import { useT } from '../../i18n';
import { useRuntime } from '../../runtime';
import { spacing } from '../../theme/tokens';
import { Banner } from '../../ui/Banner';
import { Button } from '../../ui/Button';
import { useCountdown } from '../../ui/Countdown';
import { formatCountdown } from '../../format';
import { OtpInput, OTP_LENGTH, type OtpInputHandle } from '../../ui/OtpInput';
import { Header, Screen } from '../../ui/Screen';
import { AppText } from '../../ui/Text';
import { useToast } from '../../ui/Toast';

export interface OtpScreenProps {
  /** Back to the phone screen (also used when there is no pending challenge). */
  onBack: () => void;
  /** Session stored; route by `me` (profile / onboarding / tabs). */
  onSignedIn: (me: Me, isNewUser: boolean) => void;
}

/** Board 02 A2 "Təsdiq kodu": 6 boxes, auto-submit, resend timer, dev code hint. */
export function OtpScreen({ onBack, onSignedIn }: OtpScreenProps) {
  const { t, locale } = useT();
  const runtime = useRuntime();
  const toast = useToast();
  const challenge = useOtpFlow((s) => s.challenge);
  const resendAt = useOtpFlow((s) => s.resendAvailableAt);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const inputRef = useRef<OtpInputHandle>(null);
  // Set once the session is stored: clearing the challenge afterwards must not send the user back.
  const completed = useRef(false);
  // Resend availability is measured in client time (no server offset).
  const resendLeft = useCountdown(resendAt || null, { offsetMs: 0 });

  useEffect(() => {
    if (!challenge && !completed.current) onBack();
  }, [challenge, onBack]);

  if (!challenge) return null;

  const verify = async (value: string) => {
    if (verifying || value.length !== OTP_LENGTH) return;
    setVerifying(true);
    setError(null);
    try {
      const deviceId = await runtime.auth.getState().getDeviceId();
      const res = await runtime.api.call(api.auth.otpVerify, {
        body: { challengeId: challenge.challengeId, code: value, deviceId, app: runtime.app },
      });
      completed.current = true;
      await runtime.auth.getState().signIn(res.tokens, res.me);
      otpFlowStore.getState().clear();
      onSignedIn(res.me, res.isNewUser);
    } catch (err) {
      setError(errorMessage(t, err));
      const codeName = errorCodeOf(err);
      if (codeName === 'OTP_INVALID' || codeName === 'OTP_EXPIRED' || codeName === 'OTP_TOO_MANY_ATTEMPTS') {
        setCode('');
        inputRef.current?.focus();
      }
    } finally {
      setVerifying(false);
    }
  };

  const resend = async () => {
    if (resendLeft > 0 || resending) return;
    setResending(true);
    setError(null);
    try {
      const res = await runtime.api.call(api.auth.otpRequest, {
        body: { phone: challenge.phone, app: runtime.app, locale },
      });
      otpFlowStore.getState().setChallenge(res);
      setCode('');
      toast.show(t('auth.codeSent'), { kind: 'success' });
    } catch (err) {
      setError(errorMessage(t, err));
    } finally {
      setResending(false);
    }
  };

  return (
    <Screen scroll testID="otp-screen">
      <Header large onBack={onBack} title={t('auth.otpTitle')} subtitle={t('auth.otpSubtitle', { phone: formatPhone(challenge.phone, 'international') })} />
      {challenge.devCode ? <Banner tone="info" icon="bug-outline" message={t('auth.devCodeHint', { code: challenge.devCode })} testID="otp-dev-hint" /> : null}
      <OtpInput
        ref={inputRef}
        value={code}
        onChange={(v) => {
          setCode(v);
          if (error) setError(null);
        }}
        onComplete={(v) => void verify(v)}
        error={!!error}
        disabled={verifying}
        accessibilityLabel={t('auth.otpTitle')}
      />
      {error ? (
        <AppText variant="small" color="danger" style={styles.error} accessibilityLiveRegion="polite" testID="otp-error">
          {error}
        </AppText>
      ) : null}
      <Pressable onPress={() => void resend()} disabled={resendLeft > 0 || resending} style={styles.resend} testID="otp-resend" accessibilityRole="button">
        <AppText variant="small" color={resendLeft > 0 ? 'textMuted' : 'primary'} style={styles.resendText}>
          {resendLeft > 0 ? t('auth.resendIn', { time: formatCountdown(resendLeft) }) : t('auth.resend')}
        </AppText>
      </Pressable>
      <View style={styles.spacer} />
      <Button
        title={t('auth.verify')}
        onPress={() => void verify(code)}
        disabled={code.length !== OTP_LENGTH}
        loading={verifying}
        testID="otp-verify"
      />
      <Pressable onPress={onBack} style={styles.change} testID="otp-change-number" accessibilityRole="button">
        <AppText variant="small" color="textMuted" align="center">
          {t('auth.changeNumber')}
        </AppText>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  error: { marginTop: spacing.sm },
  resend: { marginTop: spacing.lg, alignSelf: 'flex-start' },
  resendText: { fontFamily: 'Inter_600SemiBold' },
  spacer: { flex: 1, minHeight: spacing.xl },
  change: { marginTop: spacing.md, paddingVertical: spacing.sm },
});
