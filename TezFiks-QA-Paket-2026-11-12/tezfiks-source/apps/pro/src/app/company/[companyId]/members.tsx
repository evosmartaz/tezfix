import React, { useState } from 'react';
import { Share, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, formatDate, type CompanyRole, type InviteView, type MemberView } from '@tezfiks/shared';
import {
  AppText,
  Avatar,
  Badge,
  BottomSheet,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Header,
  LoadingState,
  Screen,
  errorMessage,
  serverNow,
  spacing,
  useApi,
  useT,
  useToast,
} from '@tezfiks/mobile';
import { qk } from '../../../hooks/queries';
import { liveInvites } from '../../../lib/company';

/** Members & invite links (board 04): who works for the company, invite sharing with Share.share, revoke, remove. */
export default function CompanyMembers() {
  const { t } = useT();
  const client = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ companyId: string }>();
  const companyId = typeof params.companyId === 'string' ? params.companyId : '';
  const company = useQuery({ queryKey: qk.company(companyId), enabled: !!companyId, queryFn: () => client.call(api.company.get, { params: { companyId } }) });
  const members = useQuery({ queryKey: qk.members(companyId), enabled: !!companyId, queryFn: () => client.call(api.company.members, { params: { companyId } }) });
  const invites = useQuery({ queryKey: qk.invites(companyId), enabled: !!companyId, queryFn: () => client.call(api.company.invites, { params: { companyId } }) });
  const [creating, setCreating] = useState<CompanyRole | null>(null);
  const [removing, setRemoving] = useState<MemberView | null>(null);
  const [busy, setBusy] = useState(false);

  const share = (inv: InviteView) =>
    void Share.share({ message: t('company.invites.shareMessage', { company: company.data?.name ?? '', url: inv.url }) }).catch(() => undefined);

  const create = async (role: CompanyRole) => {
    setCreating(role);
    try {
      const inv = await client.call(api.company.createInvite, { params: { companyId }, body: { role, maxUses: 10, expiresInDays: 7 } });
      toast.show(t('company.invites.created'), { kind: 'success' });
      void queryClient.invalidateQueries({ queryKey: qk.invites(companyId) });
      share(inv);
    } catch (err) {
      toast.show(errorMessage(t, err), { kind: 'error' });
    } finally {
      setCreating(null);
    }
  };

  const revoke = async (inv: InviteView) => {
    try {
      await client.call(api.company.revokeInvite, { params: { companyId, inviteId: inv.id } });
      toast.show(t('company.invites.revoked'), { kind: 'success' });
      void queryClient.invalidateQueries({ queryKey: qk.invites(companyId) });
    } catch (err) {
      toast.show(errorMessage(t, err), { kind: 'error' });
    }
  };

  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      await client.call(api.company.removeMember, { params: { companyId, userId: removing.userId } });
      toast.show(t('company.members.removed'), { kind: 'success' });
      setRemoving(null);
      void queryClient.invalidateQueries({ queryKey: qk.members(companyId) });
    } catch (err) {
      toast.show(errorMessage(t, err), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const list = (members.data?.items ?? []).filter((m) => m.status === 'ACTIVE');
  const open = liveInvites(invites.data?.items ?? [], serverNow());
  return (
    <Screen scroll testID="members-screen" onRefresh={() => void members.refetch()} refreshing={members.isRefetching}>
      <Header title={t('company.members.title')} subtitle={company.data?.name} onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
      {members.isLoading ? <LoadingState /> : null}
      {members.isError ? <ErrorState error={members.error} message={errorMessage(t, members.error)} onRetry={() => void members.refetch()} /> : null}
      {members.data && !list.length ? <EmptyState icon="people-outline" title={t('company.members.empty')} testID="members-empty" /> : null}
      {list.map((m) => (
        <Card key={m.userId} style={styles.card} testID={`member-${m.userId}`}>
          <View style={styles.row}>
            <Avatar uri={m.photo?.url} firstName={m.firstName} lastName={m.lastName} size={44} />
            <View style={styles.text}>
              <AppText variant="bodyStrong">{`${m.firstName} ${m.lastName}`}</AppText>
              <AppText variant="caption" color="textMuted">
                {t('company.members.line', {
                  role: t(`common:companyRole.${m.role}`),
                  rating: m.ratingAvg !== null ? m.ratingAvg.toFixed(1) : '—',
                  jobs: m.completedCount,
                })}
              </AppText>
            </View>
            <Badge
              label={m.busy ? t('company.busy') : m.isOnline ? t('company.members.online') : t('company.members.offline')}
              tone={m.busy ? 'warning' : m.isOnline ? 'success' : 'neutral'}
            />
          </View>
          {m.role === 'WORKER' ? (
            <Button variant="ghost" size="sm" fullWidth={false} title={t('company.members.remove')} onPress={() => setRemoving(m)} testID={`member-remove-${m.userId}`} />
          ) : null}
        </Card>
      ))}

      <AppText variant="h3" style={styles.section}>
        {t('company.invites.title')}
      </AppText>
      {invites.data && !open.length ? (
        <AppText variant="small" color="textMuted" testID="invites-empty">
          {t('company.invites.empty')}
        </AppText>
      ) : null}
      {open.map((inv) => (
        <Card key={inv.id} style={styles.card} testID={`invite-${inv.id}`}>
          <AppText variant="small" selectable testID={`invite-url-${inv.id}`}>
            {inv.url}
          </AppText>
          <AppText variant="caption" color="textMuted">
            {t('company.invites.usage', { role: t(`common:companyRole.${inv.role}`), used: inv.usedCount, max: inv.maxUses, date: formatDate(inv.expiresAt) })}
          </AppText>
          <View style={[styles.row, styles.line]}>
            <Button size="sm" title={t('company.invites.share')} onPress={() => share(inv)} fullWidth={false} style={styles.action} testID={`invite-share-${inv.id}`} />
            <Button variant="outline" size="sm" title={t('company.invites.revoke')} onPress={() => void revoke(inv)} fullWidth={false} style={styles.action} testID={`invite-revoke-${inv.id}`} />
          </View>
        </Card>
      ))}
      <Button title={t('company.invites.createWorker')} onPress={() => void create('WORKER')} loading={creating === 'WORKER'} style={styles.line} testID="invite-create-worker" />
      <Button variant="outline" title={t('company.invites.createManager')} onPress={() => void create('MANAGER')} loading={creating === 'MANAGER'} style={styles.line} testID="invite-create-manager" />

      <BottomSheet visible={!!removing} onClose={() => setRemoving(null)} title={removing ? t('company.members.removeTitle', { name: `${removing.firstName} ${removing.lastName}` }) : undefined} testID="member-remove-sheet">
        <View style={styles.row}>
          <Button variant="outline" title={t('common:actions.cancel')} onPress={() => setRemoving(null)} fullWidth={false} style={styles.action} />
          <Button variant="danger" title={t('company.members.remove')} onPress={() => void remove()} loading={busy} fullWidth={false} style={styles.action} testID="member-remove-confirm" />
        </View>
      </BottomSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center' },
  text: { flex: 1, marginHorizontal: spacing.md },
  section: { marginTop: spacing.lg, marginBottom: spacing.sm },
  line: { marginTop: spacing.sm },
  action: { flex: 1, marginHorizontal: spacing.xs },
});
