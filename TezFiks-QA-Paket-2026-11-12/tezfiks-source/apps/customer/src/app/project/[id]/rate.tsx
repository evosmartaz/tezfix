import React, { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@tezfiks/shared';
import { ErrorState, Header, LoadingState, Screen, errorCodeOf, useApi, useT, useToast } from '@tezfiks/mobile';
import { RatingForm } from '../../../components/RatingForm';
import { qk, useProject } from '../../../data/queries';
import { requestErrorInfo } from '../../../lib/requestErrors';

/** Rate the provider of a finished B2B project (POST /projects/:id/rating, once). */
export default function ProjectRateRoute() {
  const { t } = useT();
  const client = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useProject(id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = () => router.replace(`/project/${id}` as never);

  if (q.isPending) return <LoadingState testID="project-rate-loading" />;
  if (q.isError || !q.data) {
    return (
      <Screen testID="project-rate-screen">
        <Header onBack={done} />
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </Screen>
    );
  }
  const p = q.data;

  const submit = async (rating: { stars: number; comment?: string }) => {
    setBusy(true);
    setError(null);
    try {
      await client.call(api.projects.rate, { params: { id: p.id }, body: rating });
      toast.show(t('rate.thanks'), { kind: 'success' });
      void queryClient.invalidateQueries({ queryKey: qk.project(p.id) });
      done();
    } catch (err) {
      if (errorCodeOf(err) === 'ALREADY_RATED') {
        void queryClient.invalidateQueries({ queryKey: qk.project(p.id) });
        done();
        return;
      }
      setError(t(requestErrorInfo(err).messageKey));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll edges={['top', 'bottom']} testID="project-rate-screen">
      <Header onBack={done} />
      <RatingForm
        title={t('rate.done')}
        subtitle={p.awardedQuote?.provider.name ?? p.category.name}
        heading={t('rate.projectTitle')}
        submitting={busy}
        error={error}
        onSubmit={(r) => void submit(r)}
        testID="project-rate-form"
      />
    </Screen>
  );
}
