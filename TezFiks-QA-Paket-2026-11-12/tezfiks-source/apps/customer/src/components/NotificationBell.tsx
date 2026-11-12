import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { AppText, colors, useT } from '@tezfiks/mobile';
import { useUnreadCount } from '../data/queries';
import { badgeText } from '../lib/notifications';

/** Bell with the unread count (GET /notifications/unread-count, refreshed by `notification:new`). */
export function NotificationBell({ dark, testID = 'notification-bell' }: { dark?: boolean; testID?: string }) {
  const { t } = useT();
  const unread = useUnreadCount();
  const badge = badgeText(unread.data);
  return (
    <Pressable onPress={() => router.push('/notifications' as never)} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('notifications.title')} testID={testID}>
      <Ionicons name="notifications-outline" size={24} color={dark ? colors.textInverse : colors.text} />
      {badge ? (
        <View style={styles.badge} testID={`${testID}-badge`}>
          <AppText variant="caption" color="textInverse" style={styles.badgeText}>
            {badge}
          </AppText>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    top: -6,
    right: -8,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 10, lineHeight: 12 },
});
