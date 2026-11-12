import React from 'react';
import type { ColorValue } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router/js-tabs';
import { colors, fonts, useT } from '@tezfiks/mobile';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

function icon(name: IconName) {
  return ({ color, size }: { color: ColorValue; size: number }) => (
    <Ionicons name={name} color={typeof color === 'string' ? color : colors.textMuted} size={size} />
  );
}

/** Pro tabs: Əsas, Sifarişlər, Balans, Profil. */
export default function ProTabsLayout() {
  const { t } = useT();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontFamily: fonts.semibold, fontSize: 11 },
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('tabs.home'), tabBarIcon: icon('home-outline'), tabBarButtonTestID: 'tab-home' }} />
      <Tabs.Screen name="orders" options={{ title: t('tabs.orders'), tabBarIcon: icon('briefcase-outline'), tabBarButtonTestID: 'tab-orders' }} />
      <Tabs.Screen name="balance" options={{ title: t('tabs.balance'), tabBarIcon: icon('wallet-outline'), tabBarButtonTestID: 'tab-balance' }} />
      <Tabs.Screen name="profile" options={{ title: t('tabs.profile'), tabBarIcon: icon('person-outline'), tabBarButtonTestID: 'tab-profile' }} />
    </Tabs>
  );
}
