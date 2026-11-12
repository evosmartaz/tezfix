import React, { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { api, formatMoney } from '@tezfiks/shared';
import { AppText, Banner, Button, ErrorState, Header, LoadingState, Screen, TextField, useApi, useT, useToast } from '@tezfiks/mobile';
import { qk, useAssignment } from '../../../data/queries';
import { requestErrorInfo } from '../../../lib/requestErrors';

const DISPUTE_MIN = 3;
const DISPUTE_MAX = 1000;

/** Price dispute (spec 4.5): the customer explains why; an admin resolves it (PRICE_DISPUTED). */
export default function DisputeRoute() {
  const { t, locale } = useT();
  const client = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useAssignment(id);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const back = () => (router.canGoBack() ? router.back() : router.replace(`/assignment/${id}` as never));

  if (q.isPending) return <LoadingState testID="dispute-loading" />;
  if (q.isError || !q.data) {
    return (
      <Screen testID="dispute-screen">
        <Header onBack={back} />
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </Screen>
    );
  }
  const a = q.data;

  const submit = async () => {
    const text = reason.trim();
    if (text.length < DISPUTE_MIN) {
      setError(t('dispute.reasonTooShort'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await client.call(api.assignments.disputePrice, { params: { id: a.id }, body: { reason: text } });
      queryClient.setQueryData(qk.assignment(a.id), updated);
      void queryClient.invalidateQueries({ queryKey: qk.request(a.requestId) });
      toast.show(t('dispute.sent'), { kind: 'success' });
      router.replace(`/assignment/${a.id}` as never);
    } catch (err) {
      setError(t(requestErrorInfo(err).messageKey));
      void q.refetch();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll edges={['top', 'bottom']} testID="dispute-screen">
      <Header onBack={back} title={t('dispute.title')} />
      {!a.actions.disputePrice ? (
        <Banner tone="info" message={t('pay.notProposed')} testID="dispute-unavailable" />
      ) : (
        <>
          <AppText variant="body" testID="dispute-text">
            {t('dispute.text', { amount: formatMoney(a.price?.total ?? 0, locale) })}
          </AppText>
          <TextField
            label={t('dispute.reasonLabel')}
            placeholder={t('dispute.reasonPlaceholder')}
            value={reason}
            onChangeText={(v) => {
              setReason(v);
              setError(null);
            }}
            multiline
            maxLength={DISPUTE_MAX}
            error={error}
            testID="dispute-reason"
          />
          <Button variant="danger" title={t('dispute.submit')} onPress={() => void submit()} loading={busy} testID="dispute-submit" />
        </>
      )}
    </Screen>
  );
}
