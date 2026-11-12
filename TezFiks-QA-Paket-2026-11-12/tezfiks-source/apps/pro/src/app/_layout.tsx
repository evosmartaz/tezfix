import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { MobileProviders, colors, useAuth, useBootstrap, usePushRegistration, useServerLocaleSync, useT } from '@tezfiks/mobile';
import { ENTRY_ROUTES } from '../routes';
import { runtime } from '../runtime';
import { installProTagline } from '../lib/brand';
import { useProEntryRedirect } from '../lib/entry';
import { hydratePendingInvite } from '../lib/invite';
import { hydrateMode, resetMode } from '../lib/mode';
import { installNotificationHandler } from '../online/alert';
import { stopOnlineTracking } from '../online/tracking';
import { useJobsRealtime, useLocaleRefetch, useProfileRealtime } from '../hooks/queries';
import { useRouteTrackingGuard } from '../hooks/useRouteTracking';
import { useTrackingGuard } from '../hooks/useOnlineSession';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);
installNotificationHandler();
installProTagline();
void hydratePendingInvite(runtime.storage);
void hydrateMode(runtime.storage);

export default function RootLayout() {
  return (
    <MobileProviders runtime={runtime}>
      <Root />
    </MobileProviders>
  );
}

function Root() {
  const ready = useBootstrap(runtime, 'pro');
  const target = useProEntryRedirect(ENTRY_ROUTES, ready);
  const { t } = useT();
  usePushRegistration({ offers: t('notifications.channelOffers'), default: t('notifications.channelDefault') });
  // Pushes are written in Me.locale: keep it equal to the language the app shows.
  useServerLocaleSync();
  useLocaleRefetch();
  useProfileRealtime();
  useJobsRealtime();
  useTrackingGuard();
  useRouteTrackingGuard();

  // A sign-out ends location reporting and forgets the personal/company mode choice.
  const signedOut = useAuth((s) => s.status === 'signedOut');
  useEffect(() => {
    if (!signedOut) return;
    void stopOnlineTracking();
    resetMode();
  }, [signedOut]);

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
