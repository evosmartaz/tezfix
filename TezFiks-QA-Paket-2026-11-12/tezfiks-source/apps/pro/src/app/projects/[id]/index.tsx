import React, { useEffect, useRef, useState } from 'react';
import { Image, ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, formatDate, formatDateTime, formatMoney, type InvoiceView, type ProviderProjectView } from '@tezfiks/shared';
import {
  AppText,
  Badge,
  Banner,
  BottomSheet,
  Button,
  Card,
  ErrorState,
  Header,
  LoadingState,
  Screen,
  TextField,
  colors,
  errorMessage,
  newIdempotencyKey,
  radii,
  serverNow,
  spacing,
  useApi,
  useT,
  useToast,
} from '@tezfiks/mobile';
import { qk } from '../../../hooks/queries';
import { initialQuoteForm, projectStatusTone, providerPhase, quoteFee, validateQuoteForm, type QuoteField, type QuoteForm } from '../../../lib/projects';

const day = (d: string) => formatDate(`${d}T12:00:00Z`);

/** Project detail for a provider: quote form with fee preview, own quote (withdraw), daily reports, complete → invoice. */
export default function ProjectDetail() {
  const { t } = useT();
  const client = useApi();
  const params = useLocalSearchParams<{ id: string; companyId?: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const companyId = typeof params.companyId === 'string' && params.companyId ? params.companyId : null;
  const q = useQuery({
    queryKey: qk.project(id, companyId),
    enabled: !!id,
    queryFn: () => client.call(api.providerProjects.get, { params: { id }, query: companyId ? { companyId } : {} }),
  });
  const p = q.data;
  return (
    <Screen scroll testID="project-screen" onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      <Header
        title={p ? p.title ?? p.category.name : t('projects.title')}
        subtitle={p ? t('projects.number', { number: p.number }) : undefined}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/projects' as never))}
      />
      {q.isLoading ? <LoadingState /> : null}
      {q.isError ? <ErrorState error={q.error} message={errorMessage(t, q.error)} onRetry={() => void q.refetch()} /> : null}
      {p ? <ProjectBody p={p} companyId={companyId} /> : null}
    </Screen>
  );
}

function ProjectBody({ p, companyId }: { p: ProviderProjectView; companyId: string | null }) {
  const { t, locale } = useT();
  const phase = providerPhase(p, serverNow());
  return (
    <View>
      <Badge label={t(`common:projectStatus.${p.status}`)} tone={projectStatusTone(p.status)} testID="project-status" />
      <Card style={styles.block}>
        <AppText variant="caption" color="textMuted">
          {t('projects.customer')}
        </AppText>
        <AppText variant="bodyStrong">{p.customer.name}</AppText>
        <AppText variant="caption" color="textMuted" style={styles.line}>
          {t('projects.scope')}
        </AppText>
        <AppText variant="body">{p.scope}</AppText>
        <AppText variant="small" color="textMuted">
          {`${t('projects.dates', { from: day(p.dateFrom), to: day(p.dateTo) })} · ${t('projects.workers', { count: p.workersNeeded })}`}
        </AppText>
        <AppText variant="caption" color="textMuted" style={styles.line}>
          {t('projects.description')}
        </AppText>
        <AppText variant="body">{p.description}</AppText>
        {p.photos.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.line}>
            {p.photos.map((f) => (
              <Image key={f.id} source={{ uri: f.url }} style={styles.photo} />
            ))}
          </ScrollView>
        ) : null}
        <AppText variant="caption" color="textMuted" style={styles.line}>
          {t('projects.address')}
        </AppText>
        <AppText variant="body">{p.address.formatted}</AppText>
        {p.status === 'OPEN' ? (
          <AppText variant="small" color="primary" style={styles.line}>
            {t('projects.deadline', { time: formatDateTime(p.quoteDeadline) })}
          </AppText>
        ) : null}
        <AppText variant="caption" color="textMuted" style={styles.line} testID="project-fee-rate">
          {t('projects.feeRate', { amount: formatMoney(p.feePerWorkerDay, locale, { compact: true }) })}
        </AppText>
      </Card>
      {phase === 'open' ? <QuoteFormCard p={p} companyId={companyId} /> : null}
      {p.myQuote && phase !== 'open' ? <MyQuote p={p} companyId={companyId} canWithdraw={phase === 'quoted'} /> : null}
      {phase === 'awarded' ? <Banner tone="success" message={t('projects.awarded')} testID="project-awarded" /> : null}
      {p.isAwardedToMe ? <Reports p={p} companyId={companyId} canAdd={phase === 'awarded'} /> : null}
      {phase === 'awarded' ? <CompleteButton p={p} companyId={companyId} /> : null}
      {p.invoice ? <Invoice invoice={p.invoice} /> : null}
      {phase === 'closed' && !p.myQuote && !p.isAwardedToMe ? <Banner tone="neutral" message={t('projects.windowClosed')} testID="project-closed" /> : null}
    </View>
  );
}

function useInvalidateProject(id: string, companyId: string | null) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: qk.project(id, companyId) });
    void queryClient.invalidateQueries({ queryKey: qk.projectsOpen(companyId) });
    void queryClient.invalidateQueries({ queryKey: qk.projectsMine(companyId) });
    void queryClient.invalidateQueries({ queryKey: ['wallet'] });
  };
}

function QuoteFormCard({ p, companyId }: { p: ProviderProjectView; companyId: string | null }) {
  const { t, locale } = useT();
  const client = useApi();
  const toast = useToast();
  const invalidate = useInvalidateProject(p.id, companyId);
  const [form, setForm] = useState<QuoteForm>(() => initialQuoteForm(p));
  const [errors, setErrors] = useState<Partial<Record<QuoteField, string>>>({});
  const [busy, setBusy] = useState(false);
  const key = useRef(newIdempotencyKey());
  const workers = Number(form.workers);
  const days = Number(form.days);
  const fee = quoteFee(p.feePerWorkerDay, workers, days);
  const set = (k: keyof QuoteForm) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    const v = validateQuoteForm(form);
    if (!v.body) {
      setErrors(Object.fromEntries(Object.entries(v.errors).map(([k, e]) => [k, t(`projects.quote.errors.${e}`)])));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await client.call(api.providerProjects.submitQuote, {
        params: { id: p.id },
        body: { ...v.body, ...(companyId ? { companyId } : {}) },
        idempotencyKey: key.current,
      });
      key.current = newIdempotencyKey();
      toast.show(t('projects.quote.sent'), { kind: 'success' });
      invalidate();
    } catch (err) {
      toast.show(errorMessage(t, err), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={styles.block} testID="quote-form">
      <AppText variant="h3" style={styles.title}>
        {t('projects.quote.title')}
      </AppText>
      <TextField label={t('projects.quote.total')} value={form.total} onChangeText={set('total')} keyboardType="decimal-pad" error={errors.total} testID="quote-total" />
      <View style={styles.row}>
        <View style={styles.half}>
          <TextField label={t('projects.quote.workers')} value={form.workers} onChangeText={set('workers')} keyboardType="number-pad" error={errors.workers} testID="quote-workers" />
        </View>
        <View style={styles.half}>
          <TextField label={t('projects.quote.days')} value={form.days} onChangeText={set('days')} keyboardType="number-pad" error={errors.days} testID="quote-days" />
        </View>
      </View>
      <TextField label={t('projects.quote.note')} value={form.note} onChangeText={set('note')} multiline maxLength={1000} error={errors.note} testID="quote-note" />
      <View style={styles.feeBox} testID="quote-fee">
        <AppText variant="small" style={styles.feeText}>
          {t('projects.quote.feePreview', { amount: formatMoney(fee, locale, { compact: true }) })}
        </AppText>
      </View>
      <Button title={t('projects.quote.submit')} onPress={() => void submit()} loading={busy} testID="quote-submit" />
    </Card>
  );
}

function MyQuote({ p, companyId, canWithdraw }: { p: ProviderProjectView; companyId: string | null; canWithdraw: boolean }) {
  const { t, locale } = useT();
  const client = useApi();
  const toast = useToast();
  const invalidate = useInvalidateProject(p.id, companyId);
  const [busy, setBusy] = useState(false);
  const q = p.myQuote!;
  return (
    <Card style={styles.block} testID="my-quote">
      <View style={styles.row}>
        <AppText variant="h3" style={styles.flex}>
          {t('projects.myQuote')}
        </AppText>
        <Badge label={t(`common:quoteStatus.${q.status}`)} tone={q.status === 'ACCEPTED' ? 'success' : q.status === 'SUBMITTED' ? 'info' : 'neutral'} />
      </View>
      <AppText variant="body" style={styles.line}>
        {t('projects.quoteLine', { amount: formatMoney(q.totalAmount, locale), workers: q.workers, days: q.days })}
      </AppText>
      {q.note ? (
        <AppText variant="small" color="textMuted">
          {q.note}
        </AppText>
      ) : null}
      <AppText variant="small" color="textMuted" style={styles.line} testID="my-quote-fee">
        {t('projects.feeHeld', {
          amount: formatMoney(q.feeHeld, locale, { compact: true }),
          state: q.feeCaptured ? t('projects.feeStateCaptured') : t('projects.feeStateHeld'),
        })}
      </AppText>
      {canWithdraw ? (
        <Button
          variant="outline"
          title={t('projects.withdraw')}
          loading={busy}
          style={styles.line}
          onPress={async () => {
            setBusy(true);
            try {
              await client.call(api.providerProjects.withdrawQuote, { params: { id: q.id } });
              toast.show(t('projects.withdrawn'), { kind: 'success' });
              invalidate();
            } catch (err) {
              toast.show(errorMessage(t, err), { kind: 'error' });
            } finally {
              setBusy(false);
            }
          }}
          testID="quote-withdraw"
        />
      ) : null}
    </Card>
  );
}

function Reports({ p, companyId, canAdd }: { p: ProviderProjectView; companyId: string | null; canAdd: boolean }) {
  const { t } = useT();
  return (
    <Card style={styles.block} testID="project-reports">
      <AppText variant="h3">{t('projects.reports')}</AppText>
      {!p.reports.length ? (
        <AppText variant="small" color="textMuted" style={styles.line}>
          {t('projects.noReports')}
        </AppText>
      ) : null}
      {p.reports.map((r) => (
        <View key={r.id} style={styles.report} testID={`report-${r.id}`}>
          <AppText variant="caption" color="textMuted">
            {t('projects.reportLine', { date: day(r.reportDate), percent: r.progressPercent, author: r.authorName })}
          </AppText>
          <AppText variant="body">{r.note}</AppText>
          {r.photos.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.line}>
              {r.photos.map((f) => (
                <Image key={f.id} source={{ uri: f.url }} style={styles.photo} />
              ))}
            </ScrollView>
          ) : null}
        </View>
      ))}
      {canAdd ? (
        <Button
          variant="secondary"
          title={t('projects.addReport')}
          style={styles.line}
          onPress={() => router.push((companyId ? `/projects/${p.id}/report?companyId=${companyId}` : `/projects/${p.id}/report`) as never)}
          testID="project-add-report"
        />
      ) : null}
    </Card>
  );
}

function CompleteButton({ p, companyId }: { p: ProviderProjectView; companyId: string | null }) {
  const { t } = useT();
  const client = useApi();
  const toast = useToast();
  const invalidate = useInvalidateProject(p.id, companyId);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const key = useRef(newIdempotencyKey());
  useEffect(() => {
    if (open) key.current = newIdempotencyKey();
  }, [open]);
  return (
    <View style={styles.block}>
      <Button title={t('projects.complete')} onPress={() => setOpen(true)} testID="project-complete" />
      <BottomSheet visible={open} onClose={() => setOpen(false)} title={t('projects.completeTitle')} testID="project-complete-sheet">
        <AppText variant="body">{t('projects.completeBody')}</AppText>
        <Button
          title={t('common:actions.confirm')}
          loading={busy}
          style={styles.block}
          onPress={async () => {
            setBusy(true);
            try {
              await client.call(api.providerProjects.complete, { params: { id: p.id }, body: companyId ? { companyId } : {}, idempotencyKey: key.current });
              setOpen(false);
              toast.show(t('projects.completed'), { kind: 'success' });
              invalidate();
            } catch (err) {
              toast.show(errorMessage(t, err), { kind: 'error' });
            } finally {
              setBusy(false);
            }
          }}
          testID="project-complete-confirm"
        />
      </BottomSheet>
    </View>
  );
}

function Invoice({ invoice }: { invoice: InvoiceView }) {
  const { t, locale } = useT();
  const m = (n: number) => formatMoney(n, locale);
  return (
    <Card style={styles.block} testID="project-invoice">
      <View style={styles.row}>
        <AppText variant="h3" style={styles.flex}>
          {t('projects.invoice.title', { number: invoice.number })}
        </AppText>
        <Badge label={t(`common:invoiceStatus.${invoice.status}`)} tone={invoice.status === 'PAID' ? 'success' : 'warning'} />
      </View>
      <AppText variant="small" color="textMuted" style={styles.line}>
        {t('projects.invoice.issuer', { name: invoice.issuer.name })}
        {invoice.issuer.voen ? ` · ${t('projects.invoice.voen', { voen: invoice.issuer.voen })}` : ''}
      </AppText>
      <AppText variant="small" color="textMuted">
        {t('projects.invoice.customer', { name: invoice.customer.name })}
        {invoice.customer.voen ? ` · ${t('projects.invoice.voen', { voen: invoice.customer.voen })}` : ''}
      </AppText>
      {invoice.lines.map((l, i) => (
        <View key={i} style={[styles.row, styles.line]}>
          <AppText variant="small" style={styles.flex}>
            {l.description}
          </AppText>
          <AppText variant="small">{m(l.amount)}</AppText>
        </View>
      ))}
      <View style={[styles.row, styles.line]}>
        <AppText variant="small" style={styles.flex}>
          {t('projects.invoice.subtotal')}
        </AppText>
        <AppText variant="small" testID="invoice-subtotal">
          {m(invoice.subtotal)}
        </AppText>
      </View>
      <View style={styles.row}>
        <AppText variant="small" style={styles.flex}>
          {invoice.issuer.isVatPayer ? t('projects.invoice.vat', { rate: invoice.vatRatePercent }) : t('projects.invoice.noVat')}
        </AppText>
        <AppText variant="small" testID="invoice-vat">
          {m(invoice.vatAmount)}
        </AppText>
      </View>
      <View style={[styles.row, styles.line]}>
        <AppText variant="bodyStrong" style={styles.flex}>
          {t('projects.invoice.total')}
        </AppText>
        <AppText variant="bodyStrong" color="primary" testID="invoice-total">
          {m(invoice.total)}
        </AppText>
      </View>
      <AppText variant="caption" color="textMuted" style={styles.line}>
        {t('projects.invoice.issuedAt', { date: formatDate(invoice.issuedAt) })}
        {invoice.paidAt ? ` · ${t('projects.invoice.paidAt', { date: formatDate(invoice.paidAt) })}` : ''}
      </AppText>
    </Card>
  );
}

const styles = StyleSheet.create({
  block: { marginTop: spacing.md },
  line: { marginTop: spacing.sm },
  title: { marginBottom: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1, marginRight: spacing.sm },
  half: { flex: 1, marginHorizontal: spacing.xxs },
  photo: { width: 80, height: 80, borderRadius: radii.md, marginRight: spacing.sm, backgroundColor: colors.border },
  report: { marginTop: spacing.md, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  feeBox: { marginVertical: spacing.md, backgroundColor: colors.accentSoft, borderRadius: radii.md, borderWidth: 1, borderColor: colors.accent, padding: spacing.md },
  feeText: { color: '#92400E' },
});
