import React, { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@tezfiks/shared';
import { Banner, ErrorState, Header, LoadingState, Screen, useApi, useT, useToast } from '@tezfiks/mobile';
import { GuaranteeForm } from '../../../components/GuaranteeForm';
import { qk, useAssignment } from '../../../data/queries';
import { requestErrorInfo } from '../../../lib/requestErrors';

/** Guarantee claim for a card-paid job inside the guarantee period (POST /assignments/:id/guarantee-claim). */
export default function AssignmentGuaranteeRoute() {
  const { t } = useT();
  const client = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useAssignment(id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const back = () => (router.canGoBack() ? router.back() : router.replace(`/assignment/${id}` as never));

  if (q.isPending) return <LoadingState testID="guarantee-loading" />;
  if (q.isError || !q.data) {
    return (
      <Screen testID="guarantee-screen">
        <Header onBack={back} />
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </Screen>
    );
  }
  const a = q.data;

  const submit = async (body: { description: string; photoFileIds: string[] }) => {
    setBusy(true);
    setError(null);
    try {
      await client.call(api.assignments.guaranteeClaim, { params: { id: a.id }, body });
      void queryClient.invalidateQueries({ queryKey: qk.cases });
      void queryClient.invalidateQueries({ queryKey: qk.assignment(a.id) });
      toast.show(t('guarantee.sent'), { kind: 'success' });
      router.replace('/cases' as never);
    } catch (err) {
      setError(t(requestErrorInfo(err).messageKey));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll edges={['top', 'bottom']} testID="guarantee-screen">
      <Header onBack={back} title={t('guarantee.title')} />
      {a.actions.guaranteeClaim ? (
        <GuaranteeForm until={a.guaranteeUntil} submitting={busy} error={error} onSubmit={(b) => void submit(b)} />
      ) : (
        <Banner tone="info" message={t('guarantee.notAvailable')} testID="guarantee-unavailable" />
      )}
    </Screen>
  );
}
