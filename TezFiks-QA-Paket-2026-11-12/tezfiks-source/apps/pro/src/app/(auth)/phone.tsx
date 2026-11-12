import React from 'react';
import { router } from 'expo-router';
import { PhoneScreen } from '@tezfiks/mobile';

/** Board 02 A1: welcome + phone. */
export default function PhoneRoute() {
  return <PhoneScreen onCodeSent={() => router.push('/otp')} />;
}
