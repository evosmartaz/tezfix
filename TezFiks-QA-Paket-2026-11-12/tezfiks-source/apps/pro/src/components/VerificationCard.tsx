import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { VerificationStatus } from '@tezfiks/shared';
import { AppText, Button, Card, colors, spacing, useT } from '@tezfiks/mobile';

export interface VerificationCardProps {
  status: VerificationStatus | 'NONE';
  rejectReason?: string | null;
  attemptsLeft24h?: number | null;
  subject?: 'HANDYMAN' | 'COMPANY';
  onStartKyc?: () => void;
  testID?: string;
}

/** Verification state of a handyman or a company (board 03 A "Yoxlama prosesi", rejected with reason + resubmit). */
export function VerificationCard({ status, rejectReason, attemptsLeft24h, subject = 'HANDYMAN', onStartKyc, testID = 'verification-card' }: VerificationCardProps) {
  const { t } = useT();
  if (status === 'APPROVED') return null;
  if (status === 'PENDING_REVIEW') {
    return (
      <Card dark testID={`${testID}-pending`}>
        <AppText variant="h3" color="mint">
          {t('verification.pendingTitle')}
        </AppText>
        <AppText variant="small" color="textInverse" style={styles.body}>
          {t(subject === 'COMPANY' ? 'verification.pendingBodyCompany' : 'verification.pendingBody')}
        </AppText>
      </Card>
    );
  }
  if (status === 'REJECTED') {
    const canRetry = attemptsLeft24h === null || attemptsLeft24h === undefined || attemptsLeft24h > 0;
    return (
      <Card testID={`${testID}-rejected`} style={styles.danger}>
        <AppText variant="bodyStrong" color="danger">
          {t('verification.rejectedTitle')}
        </AppText>
        {rejectReason ? (
          <AppText variant="small" style={styles.body} testID={`${testID}-reason`}>
            {t('verification.reason', { reason: rejectReason })}
          </AppText>
        ) : null}
        {canRetry ? (
          <View style={styles.action}>
            <Button title={t('verification.resubmit')} onPress={onStartKyc} testID={`${testID}-resubmit`} />
            {attemptsLeft24h !== null && attemptsLeft24h !== undefined ? (
              <AppText variant="caption" color="textMuted" style={styles.body}>
                {t('verification.attemptsLeft', { count: attemptsLeft24h })}
              </AppText>
            ) : null}
          </View>
        ) : (
          <AppText variant="small" color="textMuted" style={styles.body}>
            {t('verification.limitReached')}
          </AppText>
        )}
      </Card>
    );
  }
  if (status === 'BLOCKED') {
    return (
      <Card testID={`${testID}-blocked`} style={styles.danger}>
        <AppText variant="bodyStrong" color="danger">
          {t('verification.blockedTitle')}
        </AppText>
        <AppText variant="small" style={styles.body}>
          {t('verification.blockedBody')}
        </AppText>
      </Card>
    );
  }
  // DRAFT / NONE: documents not sent yet
  return (
    <Card testID={`${testID}-draft`}>
      <AppText variant="bodyStrong">{t(subject === 'COMPANY' ? 'verification.draftTitleCompany' : 'verification.draftTitle')}</AppText>
      <AppText variant="small" color="textMuted" style={styles.body}>
        {t('verification.draftBody')}
      </AppText>
      <View style={styles.action}>
        <Button title={t('verification.start')} onPress={onStartKyc} testID={`${testID}-start`} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  body: { marginTop: spacing.xs },
  action: { marginTop: spacing.md },
  danger: { borderWidth: 1, borderColor: colors.danger },
});
