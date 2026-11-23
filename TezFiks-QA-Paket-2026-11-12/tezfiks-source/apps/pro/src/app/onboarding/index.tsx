import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { AppText, Button, Card, Header, Screen, TextField, spacing, useAuth, useRuntime, useT } from '@tezfiks/mobile';
import { OptionCard } from '../../components/OptionCard';
import { parseInviteInput } from '../../lib/invite';

type Choice = 'solo' | 'company' | 'invite';

/** Board 03 A "Usta kimi qoşulun": Fərdi usta / Usta şirkəti / Dəvət linki ilə qoşul. */
export default function OnboardingChoice() {
  const { t } = useT();
  const runtime = useRuntime();
  const status = useAuth((s) => s.status);
  const [choice, setChoice] = useState<Choice>('solo');
  const [invite, setInvite] = useState('');
  const [inviteError, setInviteError] = useState<string | null>(null);

  const next = () => {
    if (choice === 'solo') router.push('/onboarding/solo');
    else if (choice === 'company') router.push('/onboarding/company');
    else {
      const token = parseInviteInput(invite);
      if (!token) {
        setInviteError(t('onboarding.inviteInvalid'));
        return;
      }
      setInviteError(null);
      router.push(`/join/${encodeURIComponent(token)}` as never);
    }
  };

  return (
    <Screen
      scroll
      testID="onboarding-screen"
      footer={
        <View>
          <Button title={t('common:actions.continue')} onPress={next} testID="onboarding-continue" />
          <Button
            variant="ghost"
            title={t('common:actions.logout')}
            disabled={status !== 'signedIn'}
            onPress={() => void runtime.auth.getState().logout()}
            testID="onboarding-logout"
          />
        </View>
      }
    >
      <Header large title={t('onboarding.joinTitle')} subtitle={t('onboarding.joinSubtitle')} />
      <OptionCard
        title={t('onboarding.soloTitle')}
        subtitle={t('onboarding.soloSubtitle')}
        icon="person-outline"
        selected={choice === 'solo'}
        onPress={() => setChoice('solo')}
        testID="choice-solo"
      />
      <OptionCard
        title={t('onboarding.companyTitle')}
        subtitle={t('onboarding.companySubtitle')}
        icon="business-outline"
        selected={choice === 'company'}
        onPress={() => setChoice('company')}
        testID="choice-company"
      />
      <OptionCard
        title={t('onboarding.inviteTitle')}
        subtitle={t('onboarding.inviteSubtitle')}
        icon="link-outline"
        selected={choice === 'invite'}
        onPress={() => setChoice('invite')}
        testID="choice-invite"
      />
      {choice === 'invite' ? (
        <TextField
          label={t('onboarding.inviteLabel')}
          placeholder={t('onboarding.invitePlaceholder')}
          value={invite}
          onChangeText={(v) => {
            setInvite(v);
            setInviteError(null);
          }}
          autoCapitalize="none"
          autoCorrect={false}
          error={inviteError}
          testID="invite-input"
        />
      ) : null}
      <Card dark style={styles.info}>
        <AppText variant="h3" color="mint">
          {t('verification.pendingTitle')}
        </AppText>
        <AppText variant="small" color="textInverse" style={styles.infoText}>
          {t('onboarding.reviewInfo')}
        </AppText>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  info: { marginTop: spacing.md, marginBottom: spacing.lg },
  infoText: { marginTop: spacing.xs },
});
