import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import {
  MobileProviders,
  colors,
  useBootstrap,
  useEntryRedirect,
  usePushRegistration,
  useServerLocaleSync,
  useT,
} from '@tezfiks/mobile';
import { ENTRY_ROUTES } from '../routes';
import { runtime } from '../runtime';
import { useCustomerRealtime } from '../data/queries';
import { usePushTapRouting } from '../hooks/usePushTaps';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  return (
    <MobileProviders runtime={runtime}>
      <Root />
    </MobileProviders>
  );
}

function Root() {
  const ready = useBootstrap(runtime, 'customer');
  const target = useEntryRedirect(ENTRY_ROUTES, ready);
  const { t } = useT();
  usePushRegistration({ offers: t('notifications.channelOffers'), default: t('notifications.channelDefault') });
  // Pushes are written in Me.locale: keep it equal to the language the app shows.
  useServerLocaleSync();
  useCustomerRealtime();
  usePushTapRouting(ready && target === 'main');

  useEffect(() => {
    if (ready && target !== 'loading') void SplashScreen.hideAsync().catch(() => undefined);
  }, [ready, target]);

  return (
    <>
      <StatusBar style="dark" />
      {ready ? <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} /> : null}
    </>
  );
}
