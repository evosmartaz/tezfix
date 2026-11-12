import React from 'react';
import { ProfileScreen } from '@tezfiks/mobile';

/** First and last name (+ optional photo) after the first login; the root gate moves on once the profile is complete. */
export default function ProfileSetupRoute() {
  return <ProfileScreen onDone={() => undefined} />;
}
