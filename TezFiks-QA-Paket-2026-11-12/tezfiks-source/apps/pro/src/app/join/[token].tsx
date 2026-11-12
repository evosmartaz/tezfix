import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, formatDateTime } from '@tezfiks/shared';
import {
  AppText,
  Banner,
  Button,
  Card,
  ErrorState,
  Header,
  LoadingState,
  Screen,
  errorMessage,
  spacing,
  useApi,
  useAuth,
  useT,
  useToast,
} from '@tezfiks/mobile';
import { qk, useRefreshMe } from '../../hooks/queries';
import { isValidInviteToken } from '../../lib/invite';
import { setPreferredMode } from '../../lib/mode';

/**
 * Company invite (tezfiksusta://join/<token>): public preview, then "Qoşul" → POST /invites/:token/accept.
 * Workers are approved at once (the company is verified); managers join the company's manager mode.
 */
export default function JoinInvite() {
  const { t } = useT();
  const client = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const refreshMe = useRefreshMe();
  const signedIn = useAuth((s) => s.status === 'signedIn');
  const params = useLocalSearchParams<{ token: string }>();
  const token = typeof params.token === 'string' ? params.token : '';
  const validToken = isValidInviteToken(token);
  const [joining, setJoining] = useState(false);

  const preview = useQuery({
    queryKey: qk.invite(token),
    enabled: validToken,
    queryFn: () => client.call(api.invites.preview, { params: { token } }),
  });

  const leave = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const accept = async () => {
    setJoining(true);
    try {
      const res = await client.call(api.invites.accept, { params: { token }, body: {} });
      queryClient.setQueryData(qk.profile, res);
      const managed = res.managedCompanies[0];
      if (preview.data?.role === 'MANAGER' && managed) setPreferredMode({ kind: 'company', companyId: managed.id });
      await refreshMe().catch(() => undefined);
      toast.show(t('join.joined', { company: preview.data?.companyName ?? '' }), { kind: 'success' });
      router.replace('/');
    } catch (err) {
      toast.show(errorMessage(t, err), { kind: 'error' });
    } finally {
      setJoining(false);
    }
  };

  const data = preview.data;
  return (
    <Screen
      scroll
      testID="join-screen"
      footer={
        <View>
          {data?.valid && signedIn ? <Button title={t('join.accept')} onPress={() => void accept()} loading={joining} testID="join-accept" /> : null}
          <Button variant="ghost" title={t('common:actions.cancel')} onPress={leave} testID="join-cancel" />
        </View>
      }
    >
      <Header title={t('join.title')} onBack={leave} />
      {!validToken ? <Banner tone="danger" message={t('join.reason.INVALID')} testID="join-invalid" /> : null}
      {valid(preview.isLoading, validToken) ? <LoadingState /> : null}
      {preview.isError ? <ErrorState error={preview.error} message={errorMessage(t, preview.error)} onRetry={() => void preview.refetch()} /> : null}
      {data ? (
        <Card testID="join-preview">
          <AppText variant="caption" color="textMuted">
            {t('join.company')}
          </AppText>
          <AppText variant="h2" testID="join-company">
            {data.companyName}
          </AppText>
          <AppText variant="body" style={styles.line}>
            {t('join.role', { role: t(`common:companyRole.${data.role}`) })}
          </AppText>
          <AppText variant="small" color="textMuted" style={styles.line}>
            {t('join.expires', { date: formatDateTime(data.expiresAt) })}
          </AppText>
          <AppText variant="small" color="textMuted" style={styles.line}>
            {t(data.role === 'MANAGER' ? 'join.managerInfo' : 'join.workerInfo')}
          </AppText>
        </Card>
      ) : null}
      {data && !data.valid ? (
        <View style={styles.line}>
          <Banner tone="danger" message={t(`join.reason.${data.reason ?? 'INVALID'}`)} testID="join-reason" />
        </View>
      ) : null}
    </Screen>
  );
}

function valid(loading: boolean, validToken: boolean): boolean {
  return loading && validToken;
}

const styles = StyleSheet.create({
  line: { marginTop: spacing.sm },
});
