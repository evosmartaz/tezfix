import React, { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { api, shortName } from '@tezfiks/shared';
import { Banner, Button, ErrorState, Header, LoadingState, Screen, errorCodeOf, useApi, useT, useToast } from '@tezfiks/mobile';
import { RatingForm } from '../../../components/RatingForm';
import { qk, useAssignment, useRequest } from '../../../data/queries';
import { requestErrorInfo } from '../../../lib/requestErrors';

/** Board 02 C2: rate the handyman once after completion (POST /assignments/:id/rating). */
export default function RateRoute() {
  const { t } = useT();
  const client = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useAssignment(id);
  const req = useRequest(q.data?.requestId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const done = () => router.replace(`/assignment/${id}` as never);

  if (q.isPending) return <LoadingState testID="rate-loading" />;
  if (q.isError || !q.data) {
    return (
      <Screen testID="rate-screen">
        <Header onBack={done} />
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </Screen>
    );
  }
  const a = q.data;

  const submit = async (rating: { stars: number; comment?: string }) => {
    setBusy(true);
    setError(null);
    try {
      await client.call(api.assignments.rate, { params: { id: a.id }, body: rating });
      toast.show(t('rate.thanks'), { kind: 'success' });
      void queryClient.invalidateQueries({ queryKey: qk.assignment(a.id) });
      void queryClient.invalidateQueries({ queryKey: qk.request(a.requestId) });
      done();
    } catch (err) {
      if (errorCodeOf(err) === 'ALREADY_RATED') {
        void queryClient.invalidateQueries({ queryKey: qk.assignment(a.id) });
        toast.show(t('common:errors.ALREADY_RATED'));
        done();
        return;
      }
      setError(t(requestErrorInfo(err).messageKey));
    } finally {
      setBusy(false);
    }
  };

  const subtitle = [
    shortName(a.provider.firstName, a.provider.lastName),
    a.provider.trades[0] ?? req.data?.category.name,
    req.data ? t('rate.order', { number: req.data.number }) : null,
  ]
    .filter(Boolean)
    .join(' • ');

  return (
    <Screen scroll edges={['top', 'bottom']} testID="rate-screen">
      <Header onBack={done} />
      {a.rated || (!a.actions.rate && a.status === 'COMPLETED') ? (
        <>
          <Banner tone="success" message={t('rate.already')} testID="rate-done" />
          <Button title={t('pay.toJob')} onPress={done} testID="rate-back" />
        </>
      ) : (
        <RatingForm title={t('rate.done')} subtitle={subtitle} heading={t('rate.title')} submitting={busy} error={error} onSubmit={(r) => void submit(r)} testID="rate-form" />
      )}
      <Button variant="ghost" title={t('rate.later')} onPress={() => router.dismissTo('/orders' as never)} testID="rate-later" />
    </Screen>
  );
}
