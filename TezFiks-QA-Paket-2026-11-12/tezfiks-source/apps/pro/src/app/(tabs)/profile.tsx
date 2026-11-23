import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@tezfiks/shared';
import {
  AccountSummary,
  AppText,
  Badge,
  BottomSheet,
  Button,
  Card,
  Header,
  ListItem,
  Screen,
  colors,
  errorMessage,
  spacing,
  useApi,
  useRuntime,
  useT,
  useToast,
} from '@tezfiks/mobile';
import { ModeSwitcher } from '../../components/ModeSwitcher';
import { useProProfile, useUnreadCount } from '../../hooks/queries';
import { useProMode } from '../../hooks/useProMode';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
const icon = (name: IconName) => <Ionicons name={name} size={22} color={colors.primary} />;

/** Profile: work profile (trades, radius, base), notifications, earnings, payout card, projects, device setup, language, logout, delete. */
export default function ProProfile() {
  const { t } = useT();
  const profile = useProProfile();
  const mode = useProMode(profile.data);
  const unread = useUnreadCount();
  const p = profile.data?.profile ?? null;
  const solo = p?.kind === 'SOLO';
  const approvedSolo = solo && p?.status === 'APPROVED';
  const companyId = mode.kind === 'company' ? mode.companyId : null;
  const unreadCount = unread.data?.count ?? 0;
  return (
    <Screen scroll edges={['top']} testID="profile-tab-screen">
      <Header title={t('tabs.profile')} />
      <ModeSwitcher profile={profile.data} mode={mode} />
      {p ? (
        <Card style={styles.card} testID="profile-work">
          <AppText variant="bodyStrong">{t('profile.work')}</AppText>
          <AppText variant="small" color="textMuted" style={styles.line}>
            {t('profile.trades', { trades: p.trades.map((x) => x.name).join(', ') || '—' })}
          </AppText>
          <AppText variant="small" color="textMuted" style={styles.line}>
            {t('profile.radius', { km: p.serviceRadiusKm })}
          </AppText>
          <AppText variant="small" color="textMuted" style={styles.line}>
            {t('profile.status', { status: t(`common:verificationStatus.${p.status}`) })}
          </AppText>
          {p.company ? (
            <AppText variant="small" color="textMuted" style={styles.line}>
              {t('home.workerOf', { company: p.company.name })}
            </AppText>
          ) : null}
          {solo ? (
            <Button variant="outline" size="sm" fullWidth={false} title={t('profile.edit')} onPress={() => router.push('/profile-edit' as never)} style={styles.line} testID="profile-edit" />
          ) : null}
        </Card>
      ) : null}
      <Card padded={false} style={styles.card}>
        {p && p.status !== 'APPROVED' ? (
          <ListItem title={t('verification.title')} left={icon('shield-checkmark-outline')} chevron onPress={() => router.push('/verification')} testID="profile-verification" />
        ) : null}
        <ListItem
          title={t('profile.notifications')}
          left={icon('notifications-outline')}
          right={unreadCount > 0 ? <Badge label={String(unreadCount)} tone="danger" testID="profile-unread" /> : undefined}
          chevron
          onPress={() => router.push('/notifications' as never)}
          testID="profile-notifications"
        />
        {approvedSolo || companyId ? (
          <ListItem
            title={t('profile.projects')}
            left={icon('business-outline')}
            chevron
            onPress={() => router.push((companyId ? `/projects?companyId=${companyId}` : '/projects') as never)}
            testID="profile-projects"
          />
        ) : null}
        {solo || companyId ? (
          <>
            <ListItem
              title={t('profile.earnings')}
              left={icon('trending-up-outline')}
              chevron
              onPress={() => router.push((companyId ? `/earnings?companyId=${companyId}` : '/earnings') as never)}
              testID="profile-earnings"
            />
            <ListItem
              title={t('profile.payout')}
              left={icon('card-outline')}
              chevron
              onPress={() => router.push((companyId ? `/payout-method?companyId=${companyId}` : '/payout-method') as never)}
              testID="profile-payout"
            />
          </>
        ) : null}
        <ListItem
          title={t('device.title')}
          subtitle={t('device.subtitle')}
          left={icon('phone-portrait-outline')}
          chevron
          divider={false}
          onPress={() => router.push('/device-setup')}
          testID="profile-device-setup"
        />
      </Card>
      <View style={styles.gap} />
      <AccountSummary />
      <DeleteAccount />
    </Screen>
  );
}

/** Account deletion (Google Play requirement): DELETE /me, then a local sign-out. */
function DeleteAccount() {
  const { t } = useT();
  const client = useApi();
  const runtime = useRuntime();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <View style={styles.delete}>
      <Button variant="dangerOutline" title={t('profile.delete')} onPress={() => setOpen(true)} testID="profile-delete" />
      <BottomSheet visible={open} onClose={() => setOpen(false)} title={t('profile.deleteTitle')} testID="profile-delete-sheet">
        <AppText variant="body">{t('profile.deleteBody')}</AppText>
        <View style={styles.row}>
          <Button variant="outline" title={t('common:actions.cancel')} onPress={() => setOpen(false)} fullWidth={false} style={styles.action} />
          <Button
            variant="danger"
            title={t('profile.deleteConfirm')}
            loading={busy}
            fullWidth={false}
            style={styles.action}
            onPress={async () => {
              setBusy(true);
              try {
                await client.call(api.me.deleteAccount);
                setOpen(false);
                await runtime.auth.getState().logout({ remote: false });
              } catch (err) {
                toast.show(errorMessage(t, err), { kind: 'error' });
              } finally {
                setBusy(false);
              }
            }}
            testID="profile-delete-confirm"
          />
        </View>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.md },
  line: { marginTop: spacing.xs },
  gap: { height: spacing.sm },
  delete: { marginTop: spacing.md, marginBottom: spacing.xl },
  row: { flexDirection: 'row', marginTop: spacing.lg },
  action: { flex: 1, marginHorizontal: spacing.xs },
});
