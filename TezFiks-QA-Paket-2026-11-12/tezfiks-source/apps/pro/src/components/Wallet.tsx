import React, { useEffect, useRef, useState } from 'react';
import { AppState, Linking, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, formatDateTime, formatMoney, type LedgerTxView, type WalletSummary } from '@tezfiks/shared';
import {
  AppText,
  Banner,
  BottomSheet,
  Button,
  Card,
  EmptyState,
  ErrorState,
  ListItem,
  LoadingState,
  TextField,
  colors,
  errorMessage,
  newIdempotencyKey,
  radii,
  spacing,
  useApi,
  useT,
  useToast,
} from '@tezfiks/mobile';
import { Ionicons } from '@expo/vector-icons';
import { qk, usePublicConfig } from '../hooks/queries';
import { checkoutOutcome, parseTopupAmount, PAYMENT_POLL_MS, PAYMENT_RETURN_URL, shouldPollPayment, TOPUP_PRESETS } from '../lib/topup';

/** Wallet of the handyman (companyId null) or of a company the user manages. */
function useWallet(companyId: string | null) {
  const client = useApi();
  return useQuery({
    queryKey: qk.wallet(companyId),
    queryFn: (): Promise<WalletSummary> =>
      companyId ? client.call(api.company.wallet, { params: { companyId } }) : client.call(api.wallet.get, { query: { owner: 'handyman' } }),
  });
}

export function txTitle(t: (k: string, v?: Record<string, unknown>) => string, tx: LedgerTxView): string {
  const kind = t(`common:ledgerTxKind.${tx.kind}`);
  if (tx.requestNumber !== null) return t('balance.txRequest', { number: tx.requestNumber, kind });
  if (tx.projectNumber !== null) return t('balance.txProject', { number: tx.projectNumber, kind });
  return t('balance.tx', { kind });
}

/**
 * Balance (board 03 B5): dark "Cari balans" card with the low balance warning and "+ Balansı artır", a link to
 * earnings & payouts, and "Əməliyyat tarixçəsi". The same panel serves the company wallet in manager mode.
 */
export function WalletPanel({ companyId, title }: { companyId: string | null; title?: string }) {
  const { t, locale } = useT();
  const client = useApi();
  const config = usePublicConfig();
  const wallet = useWallet(companyId);
  const [topupOpen, setTopupOpen] = useState(false);
  const tx = useInfiniteQuery({
    queryKey: qk.walletTx(companyId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      companyId
        ? client.call(api.company.walletTransactions, { params: { companyId }, query: { limit: 20, ...(pageParam ? { cursor: pageParam } : {}) } })
        : client.call(api.wallet.transactions, { query: { owner: 'handyman', limit: 20, ...(pageParam ? { cursor: pageParam } : {}) } }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const fee = config.data?.requestFee ?? 1000;
  const w = wallet.data;
  const items = (tx.data?.pages ?? []).flatMap((p) => p.items);

  return (
    <View testID="wallet-panel">
      {wallet.isLoading ? <LoadingState /> : null}
      {wallet.isError ? <ErrorState error={wallet.error} message={errorMessage(t, wallet.error)} onRetry={() => void wallet.refetch()} /> : null}
      {w ? (
        <Card dark testID="wallet-card">
          <AppText variant="small" color="textInverseMuted">
            {title ?? t('balance.current')}
          </AppText>
          <AppText variant="display" color="textInverse" testID="wallet-available">
            {formatMoney(w.available, locale)}
          </AppText>
          {w.held > 0 ? (
            <AppText variant="small" color="textInverseMuted" testID="wallet-held">
              {t('balance.held', { amount: formatMoney(w.held, locale) })}
            </AppText>
          ) : null}
          {w.available < fee ? (
            <View style={styles.warnRow} testID="wallet-low">
              <Ionicons name="warning-outline" size={14} color={colors.accent} />
              <AppText variant="caption" color="accent" style={styles.warnText}>
                {t('home.lowBalance', { fee: formatMoney(fee, locale, { compact: true }) })}
              </AppText>
            </View>
          ) : null}
          <Button title={t('balance.topUp')} onPress={() => setTopupOpen(true)} style={styles.topup} testID="wallet-topup" />
        </Card>
      ) : null}
      <Card padded={false} style={styles.block}>
        <ListItem
          title={t('balance.earnings')}
          left={<Ionicons name="trending-up-outline" size={22} color={colors.primary} />}
          chevron
          divider={false}
          onPress={() => router.push((companyId ? `/earnings?companyId=${companyId}` : '/earnings') as never)}
          testID="wallet-earnings"
        />
      </Card>
      <AppText variant="h3" style={styles.block}>
        {t('balance.history')}
      </AppText>
      {tx.isLoading ? <LoadingState /> : null}
      {tx.data && !items.length ? <EmptyState icon="receipt-outline" title={t('balance.empty')} testID="wallet-tx-empty" /> : null}
      {items.length ? (
        <Card padded={false} style={styles.txCard} testID="wallet-tx">
          {items.map((it, i) => (
            <ListItem
              key={it.id}
              title={txTitle(t as never, it)}
              subtitle={formatDateTime(it.createdAt)}
              divider={i < items.length - 1}
              right={
                <AppText variant="bodyStrong" color={it.amount < 0 ? 'danger' : 'primary'} testID={`tx-amount-${it.id}`}>
                  {formatMoney(it.amount, locale, { sign: true })}
                </AppText>
              }
              testID={`tx-${it.id}`}
            />
          ))}
        </Card>
      ) : null}
      {tx.hasNextPage ? <Button variant="ghost" title={t('orders.loadMore')} onPress={() => void tx.fetchNextPage()} loading={tx.isFetchingNextPage} /> : null}
      <TopupSheet open={topupOpen} onClose={() => setTopupOpen(false)} companyId={companyId} />
    </View>
  );
}

/**
 * "+ Balansı artır": amount (presets or typed) → POST /wallet/topup (or the company top-up) → the test checkout opens
 * in the browser → the app polls GET /payments/:id (and listens to payment/wallet socket events) until it settles.
 */
export function TopupSheet({ open, onClose, companyId }: { open: boolean; onClose: () => void; companyId: string | null }) {
  const { t, locale } = useT();
  const client = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [text, setText] = useState('20');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ id: string; startedAt: number; amount: number } | null>(null);
  // Shown inside the sheet as a lasting banner next to the form (the sheet is a Modal; a toast also fades away).
  const [failure, setFailure] = useState<{ title?: string; message: string } | null>(null);
  const key = useRef(newIdempotencyKey());

  useEffect(() => {
    if (!open) return;
    key.current = newIdempotencyKey();
    setFailure(null);
  }, [open]);

  const payment = useQuery({
    queryKey: qk.payment(pending?.id ?? 'none'),
    enabled: !!pending,
    queryFn: () => client.call(api.payments.get, { params: { id: pending!.id } }),
    refetchInterval: (q) => (pending && shouldPollPayment(pending.startedAt, q.state.data?.status) ? PAYMENT_POLL_MS : false),
  });

  // Back from the browser: check at once.
  useEffect(() => {
    if (!pending) return;
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void payment.refetch();
    });
    return () => sub.remove();
  }, [pending, payment]);

  const outcome = checkoutOutcome(payment.data?.status);
  useEffect(() => {
    if (!pending || outcome === 'pending') return;
    if (outcome === 'succeeded') {
      toast.show(t('topup.succeeded', { amount: formatMoney(pending.amount, locale) }), { kind: 'success' });
      void queryClient.invalidateQueries({ queryKey: ['wallet'] });
      void queryClient.invalidateQueries({ queryKey: qk.profile });
      void queryClient.invalidateQueries({ queryKey: ['company'] });
      onClose();
    } else {
      setFailure({ title: t('topup.failed'), message: t('topup.failedBody') });
    }
    setPending(null);
  }, [outcome, pending]);

  const start = async () => {
    const parsed = parseTopupAmount(text);
    if (parsed.amount === null) {
      setError(t(`topup.errors.${parsed.error}`));
      return;
    }
    setError(null);
    setFailure(null);
    setBusy(true);
    try {
      const res = companyId
        ? await client.call(api.company.topup, { params: { companyId }, body: { amount: parsed.amount, returnUrl: PAYMENT_RETURN_URL }, idempotencyKey: key.current })
        : await client.call(api.wallet.topup, { body: { amount: parsed.amount, owner: 'handyman', returnUrl: PAYMENT_RETURN_URL }, idempotencyKey: key.current });
      key.current = newIdempotencyKey();
      setPending({ id: res.paymentIntentId, startedAt: Date.now(), amount: parsed.amount });
      await Linking.openURL(res.checkoutUrl).catch(() => undefined);
    } catch (err) {
      setFailure({ message: errorMessage(t, err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet visible={open} onClose={onClose} title={t('topup.title')} testID="topup-sheet">
      {pending ? (
        <View testID="topup-pending">
          <LoadingState />
          <AppText variant="body" align="center">
            {t('topup.waiting')}
          </AppText>
          <Button variant="outline" title={t('topup.check')} onPress={() => void payment.refetch()} style={styles.block} testID="topup-check" />
        </View>
      ) : (
        <View>
          {failure ? <Banner tone="danger" icon="alert-circle-outline" title={failure.title} message={failure.message} testID="topup-error" /> : null}
          <View style={styles.presets}>
            {TOPUP_PRESETS.map((p) => (
              <Pressable
                key={p}
                onPress={() => setText(String(p))}
                style={[styles.preset, text === String(p) ? styles.presetOn : null]}
                accessibilityRole="button"
                testID={`topup-preset-${p}`}
              >
                <AppText variant="bodyStrong" color={text === String(p) ? 'textInverse' : 'text'}>
                  {formatMoney(p * 100, locale, { compact: true })}
                </AppText>
              </Pressable>
            ))}
          </View>
          <TextField label={t('topup.amount')} value={text} onChangeText={setText} keyboardType="decimal-pad" error={error} testID="topup-amount" />
          <AppText variant="caption" color="textMuted" style={styles.hint}>
            {t('topup.testHint')}
          </AppText>
          <Button title={t('topup.pay')} onPress={() => void start()} loading={busy} testID="topup-pay" />
        </View>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  block: { marginTop: spacing.md },
  txCard: { marginTop: spacing.sm, paddingHorizontal: spacing.lg },
  warnRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm },
  warnText: { marginLeft: spacing.xs, flex: 1 },
  topup: { marginTop: spacing.md },
  presets: { flexDirection: 'row', marginBottom: spacing.md },
  preset: { flex: 1, marginHorizontal: spacing.xs, paddingVertical: spacing.md, alignItems: 'center', borderRadius: radii.md, borderWidth: 1, borderColor: colors.border },
  presetOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  hint: { marginBottom: spacing.md },
});
