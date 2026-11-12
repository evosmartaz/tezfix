import React, { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@tezfiks/shared';
import { Banner, Button, ErrorState, Header, LoadingState, Screen, useApi, useClockOffset, useT, useToast } from '@tezfiks/mobile';
import { GuaranteeForm } from '../../../components/GuaranteeForm';
import { qk, useProject } from '../../../data/queries';
import { projectGuaranteeOpen } from '../../../lib/projects';
import { requestErrorInfo } from '../../../lib/requestErrors';

/** Guarantee claim for a paid B2B project (POST /projects/:id/guarantee-claim). */
export default function ProjectGuaranteeRoute() {
  const { t } = useT();
  const client = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useProject(id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clockOffset = useClockOffset();
  const back = () => (router.canGoBack() ? router.back() : router.replace(`/project/${id}` as never));

  if (q.isPending) return <LoadingState testID="project-guarantee-loading" />;
  if (q.isError || !q.data) {
    return (
      <Screen testID="project-guarantee-screen">
        <Header onBack={back} />
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </Screen>
    );
  }
  const p = q.data;

  const submit = async (body: { description: string; photoFileIds: string[] }) => {
    setBusy(true);
    setError(null);
    try {
      await client.call(api.projects.guaranteeClaim, { params: { id: p.id }, body });
      void queryClient.invalidateQueries({ queryKey: qk.cases });
      toast.show(t('guarantee.sent'), { kind: 'success' });
      router.replace('/cases' as never);
    } catch (err) {
      setError(t(requestErrorInfo(err).messageKey));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll edges={['top', 'bottom']} testID="project-guarantee-screen">
      <Header onBack={back} title={t('guarantee.title')} />
      {projectGuaranteeOpen(p, clockOffset) ? (
        <GuaranteeForm until={p.guaranteeUntil} submitting={busy} error={error} onSubmit={(b) => void submit(b)} testID="project-guarantee-form" />
      ) : (
        <>
          <Banner tone="info" message={t('guarantee.notAvailable')} testID="project-guarantee-unavailable" />
          <Button title={t('pay.toJob')} onPress={() => router.replace(`/project/${p.id}` as never)} testID="project-guarantee-back" />
        </>
      )}
    </Screen>
  );
}
