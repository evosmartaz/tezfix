import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { api, formatMoney } from '@tezfiks/shared';
import {
  AppText,
  Banner,
  BottomSheet,
  Button,
  Card,
  ErrorState,
  Header,
  Keypad,
  LoadingState,
  Screen,
  colors,
  errorMessage,
  newIdempotencyKey,
  radii,
  spacing,
  useApi,
  useT,
  useToast,
} from '@tezfiks/mobile';
import { canEnterPrice } from '../../../lib/jobs';
import { priceTotals, validatePrice, type PriceDraft, type PriceField } from '../../../lib/price';
import { useJob } from '../../../hooks/useJob';
import { qk } from '../../../hooks/queries';

function back() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

type PriceBody = NonNullable<ReturnType<typeof validatePrice>['body']>;

/**
 * "İşi tamamla" (board 03 B4): keypad for İş haqqı and Material xərci, live Yekun məbləğ, warning, then
 * "Qiyməti təsdiqlə və işi bitir" (POST .../price, idempotent). Company jobs: only the side named by the company
 * setting reaches this form (a worker of a MANAGER-priced company never sees it).
 */
export default function PriceEntry() {
  const { t, locale } = useT();
  const client = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ id: string; companyId?: string }>();
  const id = typeof params.id === 'string' ? params.id : undefined;
  const companyId = typeof params.companyId === 'string' && params.companyId ? params.companyId : null;
  const data = useJob(id, companyId);
  const job = data.job;
  const [draft, setDraft] = useState<PriceDraft>({ labor: '', materials: '' });
  const [field, setField] = useState<PriceField>('labor');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reviewing, setReviewing] = useState<PriceBody | null>(null);
  // One Idempotency-Key per distinct body: a retry of the same amount replays the stored result (a lost response is
  // safe), while a corrected amount gets a fresh key instead of IDEMPOTENCY_CONFLICT.
  const keyFor = useRef<{ body: string; key: string } | null>(null);

  const totals = priceTotals(draft);
  const allowed = !!job && canEnterPrice(job, data.role, data.finalPriceEntry);

  // The price cannot be changed once sent, so "Qiyməti təsdiqlə" first shows the total for review.
  const review = () => {
    if (!job || saving) return;
    const v = validatePrice(draft, { allowZero: job.isGuaranteeFix });
    if (!v.body) {
      setError(t(`price.errors.${v.error}`));
      return;
    }
    setError(null);
    setReviewing(v.body);
  };

  const submit = async (body: PriceBody) => {
    if (!job) return;
    setReviewing(null);
    const bodyId = JSON.stringify(body);
    if (keyFor.current?.body !== bodyId) keyFor.current = { body: bodyId, key: newIdempotencyKey() };
    const idempotencyKey = keyFor.current.key;
    setSaving(true);
    try {
      const a = companyId
        ? await client.call(api.company.enterPrice, { params: { companyId, id: job.id }, body, idempotencyKey })
        : await client.call(api.pro.enterPrice, { params: { id: job.id }, body, idempotencyKey });
      if (companyId) queryClient.setQueryData(qk.companyAssignment(companyId, a.id), a);
      else queryClient.setQueryData(qk.assignment(a.id), a);
      void queryClient.invalidateQueries({ queryKey: ['pro', 'assignments'] });
      void queryClient.invalidateQueries({ queryKey: ['company'] });
      toast.show(t('price.sent'), { kind: 'success' });
      back();
    } catch (err) {
      toast.show(errorMessage(t, err), { kind: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const row = (f: PriceField, label: string) => (
    <Pressable
      onPress={() => setField(f)}
      style={[styles.priceRow, field === f ? styles.priceRowOn : null]}
      accessibilityRole="button"
      accessibilityState={{ selected: field === f }}
      testID={`price-${f}`}
    >
      <AppText variant="small" color="textMuted" style={styles.flex}>
        {label}
      </AppText>
      <AppText variant="bodyStrong" testID={`price-${f}-value`}>
        {formatMoney(f === 'labor' ? totals.labor : totals.materials, locale)}
      </AppText>
    </Pressable>
  );

  return (
    <Screen
      scroll
      testID="price-screen"
      footer={
        allowed ? (
          <View>
            <Button title={t('price.submit')} onPress={review} loading={saving} testID="price-submit" />
            {!companyId && data.role === 'solo' ? (
              <AppText variant="caption" color="textMuted" align="center" style={styles.note}>
                {t('price.companyNote')}
              </AppText>
            ) : null}
          </View>
        ) : undefined
      }
    >
      <Header title={job ? t('price.title', { number: job.requestNumber }) : t('price.total')} subtitle={t('price.subtitle')} onBack={back} />
      {data.isLoading ? <LoadingState /> : null}
      {data.isError ? <ErrorState error={data.error} message={errorMessage(t, data.error)} onRetry={() => void data.refetch()} /> : null}
      {job && !allowed ? <Banner tone="info" message={t('price.notAllowed')} testID="price-not-allowed" /> : null}
      {job && allowed ? (
        <View>
          <Card>
            {row('labor', t('price.labor'))}
            {row('materials', t('price.materials'))}
            <View style={styles.totalRow}>
              <AppText variant="bodyStrong" style={styles.flex}>
                {t('price.total')}
              </AppText>
              <AppText variant="h2" color="primary" testID="price-total">
                {formatMoney(totals.total, locale)}
              </AppText>
            </View>
          </Card>
          {job.isGuaranteeFix ? <Banner tone="info" message={t('price.guaranteeFix')} /> : null}
          <View style={styles.warning} testID="price-warning">
            <AppText variant="small" style={styles.warningText}>
              {t('price.warning')}
            </AppText>
          </View>
          {error ? (
            <AppText variant="small" color="danger" testID="price-error">
              {error}
            </AppText>
          ) : null}
          <Keypad value={draft[field]} onChange={(v) => setDraft((d) => ({ ...d, [field]: v }))} testID="price-keypad" />
        </View>
      ) : null}
      <BottomSheet visible={!!reviewing} onClose={() => setReviewing(null)} title={t('price.confirm.title')} testID="price-confirm-sheet">
        {reviewing ? (
          <View>
            <AppText variant="body" testID="price-confirm-body">
              {t('price.confirm.body', {
                total: formatMoney(reviewing.labor + reviewing.materials, locale),
                labor: formatMoney(reviewing.labor, locale),
                materials: formatMoney(reviewing.materials, locale),
              })}
            </AppText>
            <View style={styles.confirmRow}>
              <Button
                variant="outline"
                title={t('price.confirm.edit')}
                onPress={() => setReviewing(null)}
                fullWidth={false}
                style={styles.confirmAction}
                testID="price-confirm-edit"
              />
              <Button
                title={t('price.confirm.send')}
                onPress={() => void submit(reviewing)}
                fullWidth={false}
                style={styles.confirmAction}
                testID="price-confirm-send"
              />
            </View>
          </View>
        ) : null}
      </BottomSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  priceRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, paddingHorizontal: spacing.sm, borderRadius: radii.md },
  priceRowOn: { backgroundColor: colors.primarySoft },
  totalRow: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.border, marginTop: spacing.sm, paddingTop: spacing.md, paddingHorizontal: spacing.sm },
  warning: { marginVertical: spacing.md, backgroundColor: colors.accentSoft, borderRadius: radii.md, borderWidth: 1, borderColor: colors.accent, padding: spacing.md },
  warningText: { color: '#92400E' },
  note: { marginTop: spacing.sm },
  confirmRow: { flexDirection: 'row', marginTop: spacing.lg },
  confirmAction: { flex: 1, marginHorizontal: spacing.xs },
});
