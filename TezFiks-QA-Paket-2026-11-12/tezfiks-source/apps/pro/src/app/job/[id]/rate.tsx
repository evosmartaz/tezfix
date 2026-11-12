import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { api, shortName, type ProAssignment } from '@tezfiks/shared';
import { AppText, Avatar, Button, Header, Screen, Stars, TextField, errorCodeOf, errorMessage, spacing, useApi, useT, useToast } from '@tezfiks/mobile';
import { useJob } from '../../../hooks/useJob';
import { qk } from '../../../hooks/queries';

function done(id: string | undefined) {
  if (router.canGoBack()) router.back();
  else router.replace((id ? `/job/${id}` : '/') as never);
}

/** The provider rates the customer once after completion (1–5 + optional comment; ALREADY_RATED is final). */
export default function RateCustomer() {
  const { t } = useT();
  const client = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const id = typeof rawId === 'string' ? rawId : undefined;
  const { job } = useJob(id, null);
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!id) return;
    if (stars < 1) {
      setError(t('rate.pickStars'));
      return;
    }
    setSaving(true);
    try {
      await client.call(api.pro.rateCustomer, { params: { id }, body: { stars, ...(comment.trim() ? { comment: comment.trim() } : {}) } });
      toast.show(t('rate.thanks'), { kind: 'success' });
      queryClient.setQueryData<ProAssignment>(qk.assignment(id), (a) => (a ? { ...a, ratedCustomer: true } : a));
      void queryClient.invalidateQueries({ queryKey: qk.assignment(id) });
      void queryClient.invalidateQueries({ queryKey: ['pro', 'assignments'] });
      done(id);
    } catch (err) {
      if (errorCodeOf(err) === 'ALREADY_RATED') {
        void queryClient.invalidateQueries({ queryKey: qk.assignment(id) });
        done(id);
      }
      toast.show(errorMessage(t, err), { kind: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const name = job ? shortName(job.customer.firstName, job.customer.lastInitial) : '';
  return (
    <Screen
      scroll
      testID="rate-screen"
      footer={
        <View>
          <Button title={t('rate.submit')} onPress={() => void submit()} loading={saving} testID="rate-submit" />
          <Button variant="ghost" title={t('rate.skip')} onPress={() => done(id)} testID="rate-skip" />
        </View>
      }
    >
      <Header title={t('rate.title')} onBack={() => done(id)} />
      <View style={styles.center}>
        {job ? <Avatar uri={job.customer.photo?.url} firstName={job.customer.firstName} lastName={job.customer.lastInitial} size={72} /> : null}
        <AppText variant="body" style={styles.line} align="center">
          {t('rate.subtitle', { name })}
        </AppText>
        <View style={styles.line}>
          <Stars
            value={stars}
            onChange={(v) => {
              setStars(v);
              setError(null);
            }}
            size={36}
            testID="rate-stars"
          />
        </View>
        {error ? (
          <AppText variant="small" color="danger" style={styles.line} testID="rate-error">
            {error}
          </AppText>
        ) : null}
      </View>
      <TextField label={t('rate.comment')} value={comment} onChangeText={setComment} multiline maxLength={500} testID="rate-comment" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', marginBottom: spacing.lg },
  line: { marginTop: spacing.md },
});
