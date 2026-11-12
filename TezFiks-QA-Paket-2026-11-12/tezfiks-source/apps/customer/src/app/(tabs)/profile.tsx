import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, formatPhone } from '@tezfiks/shared';
import {
  AppText,
  Avatar,
  BottomSheet,
  Button,
  Card,
  LanguagePicker,
  ListItem,
  Screen,
  Header,
  Stars,
  TextField,
  colors,
  errorMessage,
  spacing,
  useAuth,
  useRuntime,
  useT,
  useToast,
} from '@tezfiks/mobile';
import { useCustomerAccount, usePublicConfig, useUnreadCount } from '../../data/queries';
import { badgeText } from '../../lib/notifications';
import { deleteConfirmMatches } from '../../lib/profile';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/** Profil: own header (name, phone, photo), company info, address book, notifications, business orders, claims, language, logout, delete account. */
export default function CustomerProfile() {
  const { t } = useT();
  const runtime = useRuntime();
  const toast = useToast();
  const me = useAuth((s) => s.me);
  const account = useCustomerAccount();
  const config = usePublicConfig();
  const unread = useUnreadCount();
  const [loggingOut, setLoggingOut] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const acc = account.data;

  const logout = async () => {
    setLoggingOut(true);
    await runtime.auth.getState().logout();
    setLoggingOut(false);
  };

  const deleteAccount = async () => {
    if (!deleteConfirmMatches(confirmText, t('profile.deleteWord'))) return;
    setDeleting(true);
    try {
      await runtime.api.call(api.me.deleteAccount);
      setDeleteOpen(false);
      toast.show(t('profile.deleted'), { kind: 'success' });
      await runtime.auth.getState().logout({ remote: false });
    } catch (err) {
      toast.show(errorMessage(t, err), { kind: 'error' });
    } finally {
      setDeleting(false);
    }
  };

  const item = (icon: IconName, title: string, href: Href, testID: string, right?: React.ReactNode) => (
    <ListItem title={title} left={<Ionicons name={icon} size={20} color={colors.primary} />} right={right} chevron onPress={() => router.push(href)} testID={testID} />
  );
  const unreadBadge = badgeText(unread.data);

  return (
    <Screen scroll edges={['top']} testID="profile-tab-screen">
      <Header title={t('tabs.profile')} />
      <Card style={styles.block} onPress={() => router.push('/profile/edit' as never)} testID="account-summary">
        <View style={styles.row}>
          <Avatar uri={me?.photo?.url} firstName={me?.firstName} lastName={me?.lastName} size={56} />
          <View style={styles.text}>
            <AppText variant="h3">{[me?.firstName, me?.lastName].filter(Boolean).join(' ')}</AppText>
            {me?.phone ? (
              <AppText variant="small" color="textMuted">
                {formatPhone(me.phone, 'international')}
              </AppText>
            ) : null}
            {acc && acc.ratingAvg !== null ? <Stars value={acc.ratingAvg} size={12} showValue testID="profile-rating" /> : null}
          </View>
          <Ionicons name="create-outline" size={20} color={colors.textMuted} />
        </View>
      </Card>

      <Card style={styles.block} testID="profile-account">
        <ListItem
          title={t(`common:customerType.${acc?.type ?? me?.customer?.type ?? 'INDIVIDUAL'}`)}
          subtitle={acc?.type === 'COMPANY' ? [acc.companyName, acc.voen ? `${t('common:fields.voen')}: ${acc.voen}` : null].filter(Boolean).join(' · ') : t('account.individualHint')}
          left={<Ionicons name={acc?.type === 'COMPANY' ? 'business-outline' : 'person-outline'} size={20} color={colors.primary} />}
          chevron
          onPress={() => router.push('/profile/company' as never)}
          divider={false}
          testID="profile-company"
        />
      </Card>

      <Card style={styles.block}>
        {item('location-outline', t('profile.addresses'), '/addresses' as Href, 'profile-addresses')}
        {item(
          'notifications-outline',
          t('notifications.title'),
          '/notifications' as Href,
          'profile-notifications',
          unreadBadge ? (
            <View style={styles.badge} testID="profile-unread">
              <AppText variant="caption" color="textInverse">
                {unreadBadge}
              </AppText>
            </View>
          ) : undefined,
        )}
        {item('briefcase-outline', t('profile.projects'), '/projects' as Href, 'profile-projects')}
        {item('shield-checkmark-outline', t('cases.title'), '/cases' as Href, 'profile-cases')}
      </Card>

      <AppText variant="bodyStrong" style={styles.section}>
        {t('auth.language')}
      </AppText>
      <LanguagePicker mode="full" />

      {config.data?.supportPhone ? (
        <AppText variant="small" color="textMuted" style={styles.section} testID="profile-support">
          {t('profile.support', { phone: config.data.supportPhone })}
        </AppText>
      ) : null}

      <View style={styles.logout}>
        <Button variant="outline" title={t('common:actions.logout')} loading={loggingOut} onPress={() => void logout()} testID="logout" />
        <View style={styles.gap} />
        <Button variant="ghost" title={t('profile.deleteAccount')} onPress={() => { setConfirmText(''); setDeleteOpen(true); }} testID="profile-delete" />
      </View>

      <BottomSheet visible={deleteOpen} onClose={() => setDeleteOpen(false)} title={t('profile.deleteTitle')} testID="profile-delete-sheet">
        <AppText variant="body" style={styles.section}>
          {t('profile.deleteText')}
        </AppText>
        <TextField label={t('profile.deleteConfirmLabel', { word: t('profile.deleteWord') })} value={confirmText} onChangeText={setConfirmText} autoCapitalize="characters" testID="profile-delete-input" />
        <Button
          variant="danger"
          title={t('profile.deleteConfirm')}
          onPress={() => void deleteAccount()}
          disabled={!deleteConfirmMatches(confirmText, t('profile.deleteWord'))}
          loading={deleting}
          testID="profile-delete-confirm"
        />
      </BottomSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  block: { marginBottom: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center' },
  text: { flex: 1, marginHorizontal: spacing.md },
  section: { marginTop: spacing.md, marginBottom: spacing.sm },
  logout: { marginTop: spacing.xl, marginBottom: spacing.xl },
  gap: { height: spacing.sm },
  badge: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
});
