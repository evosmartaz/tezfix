import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { JobScreen } from '../../../../components/JobScreen';

/** A company job seen by its manager (manager price entry, reassign, cancel). */
export default function CompanyJob() {
  const { id, companyId } = useLocalSearchParams<{ id: string; companyId: string }>();
  return <JobScreen id={typeof id === 'string' ? id : undefined} companyId={typeof companyId === 'string' ? companyId : null} />;
}
