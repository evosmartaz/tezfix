import React, { useCallback } from 'react';
import { router } from 'expo-router';
import { OtpScreen } from '@tezfiks/mobile';

/** Board 02 A2: verification code. The root gate routes to profile / account type / tabs after sign-in. */
export default function OtpRoute() {
  const back = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/phone');
  }, []);
  return <OtpScreen onBack={back} onSignedIn={() => undefined} />;
}
