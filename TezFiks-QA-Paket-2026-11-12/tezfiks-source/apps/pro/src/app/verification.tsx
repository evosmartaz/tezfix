import React from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '@tezfiks/shared';
import { Banner, Button, ErrorState, Header, LoadingState, Screen, errorMessage, spacing, useApi, useSocketEvent, useT } from '@tezfiks/mobile';
import { VerificationCard } from '../components/VerificationCard';
import { qk } from '../hooks/queries';

/** Pending / rejected screen after a KYC submission ("Yoxlama prosesi … adətən 24 saat ərzində"; reason + resubmit). */
export default function VerificationStatusScreen() {
  const { t } = useT();
  const client = useApi();
  const params = useLocalSearchParams<{ companyId?: string }>();
  const companyId = typeof params.companyId === 'string' && params.companyId ? params.companyId : null;
  const status = useQuery({
    queryKey: qk.kycStatus(companyId),
    queryFn: () => client.call(api.kyc.status, { query: companyId ? { companyId } : {} }),
    refetchInterval: 30_000,
  });
  useSocketEvent('profile:updated', () => void status.refetch());

  const startKyc = () =>
    router.replace({ pathname: '/kyc', params: companyId ? { subject: 'COMPANY', companyId } : {} } as never);

  return (
    <Screen
      scroll
      testID="verification-screen"
      onRefresh={() => void status.refetch()}
      refreshing={status.isRefetching}
      footer={<Button variant="outline" title={t('verification.toHome')} onPress={() => router.replace('/')} testID="verification-home" />}
    >
      <Header title={t('verification.title')} />
      {status.isLoading ? <LoadingState /> : null}
      {status.isError ? <ErrorState error={status.error} message={errorMessage(t, status.error)} onRetry={() => void status.refetch()} /> : null}
      {status.data ? (
        <View style={styles.gap}>
          {status.data.status === 'APPROVED' ? (
            <Banner tone="success" message={t('verification.approved')} testID="verification-approved" />
          ) : (
            <VerificationCard
              status={status.data.status}
              rejectReason={status.data.rejectReason}
              attemptsLeft24h={status.data.attemptsLeft24h}
              subject={companyId ? 'COMPANY' : 'HANDYMAN'}
              onStartKyc={startKyc}
            />
          )}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({ gap: { marginTop: spacing.sm } });
