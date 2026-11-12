import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { JobScreen } from '../../../components/JobScreen';

/** Active job of the signed-in handyman (solo, or company worker in the limited view). */
export default function ProJob() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <JobScreen id={typeof id === 'string' ? id : undefined} companyId={null} />;
}
