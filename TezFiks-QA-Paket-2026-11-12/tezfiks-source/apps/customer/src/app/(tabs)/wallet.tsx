import React, { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { formatDateTime, formatMoney, formatRequestNumber, type LedgerTxView } from '@tezfiks/shared';
import { AppText, Banner, Button, Card, EmptyState, ErrorState, Header, LoadingState, Screen, colors, spacing, useT } from '@tezfiks/mobile';
import { TopUpSheet } from '../../components/TopUpSheet';
import { useWallet, useWalletTransactions } from '../../data/queries';
import { mergePages } from '../../lib/orders';
import { topUpParam } from '../../lib/payments';

/** Pul kisəsi: balance (posted, held, available), debt banner, "Balansı artır" via the test checkout, transaction history. */
export default function CustomerWallet() {
  const { t, locale } = useT();
  const params = useLocalSearchParams<{ topup?: string }>();
  const wallet = useWallet();
  const txs = useWalletTransactions();
  const [sheet, setSheet] = useState<{ open: boolean; amount: number | null }>({ open: false, amount: null });

  // A top-up CTA elsewhere (debt, emergency shortfall, INSUFFICIENT_BALANCE) opens /wallet?topup=<amount>.
  useEffect(() => {
    const p = topUpParam(params.topup);
    if (p.open) {
      setSheet(p);
      router.setParams({ topup: undefined });
    }
  }, [params.topup]);

  const items = mergePages(txs.data?.pages);
  const w = wallet.data;

  const header = (
    <View>
      <Header title={t('tabs.wallet')} />
      {wallet.isPending ? (
        <LoadingState testID="wallet-loading" />
      ) : wallet.isError || !w ? (
        <ErrorState error={wallet.error} onRetry={() => void wallet.refetch()} testID="wallet-error" />
      ) : (
        <>
          <Card dark style={styles.block} testID="wallet-balance">
            <AppText variant="small" color="textInverseMuted">
              {t('wallet.balance')}
            </AppText>
            <AppText variant="display" color={w.isDebt ? 'danger' : 'textInverse'} testID="wallet-posted">
              {formatMoney(w.posted, locale)}
            </AppText>
            <AppText variant="small" color="textInverseMuted" testID="wallet-available">
              {t('wallet.available', { amount: formatMoney(w.available, locale) })}
            </AppText>
            {w.held > 0 ? (
              <AppText variant="small" color="textInverseMuted" testID="wallet-held">
                {t('wallet.held', { amount: formatMoney(w.held, locale) })}
              </AppText>
            ) : null}
            <Button
              title={t('wallet.topUp')}
              onPress={() => setSheet({ open: true, amount: w.isDebt ? -w.posted : null })}
              style={styles.topUp}
              testID="wallet-topup"
            />
          </Card>
          {w.isDebt ? (
            <Banner tone="danger" title={t('home.debtTitle')} message={t('home.debtMessage', { amount: formatMoney(-w.posted, locale) })} testID="wallet-debt" />
          ) : null}
          <AppText variant="caption" color="textMuted" style={styles.block}>
            {t('wallet.feeNote')}
          </AppText>
        </>
      )}
      <AppText variant="h3" style={styles.section}>
        {t('wallet.history')}
      </AppText>
    </View>
  );

  return (
    <Screen edges={['top']} testID="wallet-screen">
      <FlatList
        data={items}
        keyExtractor={(x) => x.id}
        ListHeaderComponent={header}
        renderItem={({ item }) => <TxRow tx={item} />}
        onEndReached={() => {
          if (txs.hasNextPage && !txs.isFetchingNextPage) void txs.fetchNextPage();
        }}
        onEndReachedThreshold={0.4}
        refreshControl={
          <RefreshControl
            refreshing={(wallet.isRefetching || txs.isRefetching) && !txs.isFetchingNextPage}
            onRefresh={() => {
              void wallet.refetch();
              void txs.refetch();
            }}
            tintColor={colors.primary}
          />
        }
        ListEmptyComponent={
          txs.isPending ? (
            <ActivityIndicator color={colors.primary} />
          ) : txs.isError ? (
            <ErrorState error={txs.error} onRetry={() => void txs.refetch()} testID="wallet-tx-error" />
          ) : (
            <EmptyState icon="swap-vertical-outline" title={t('wallet.empty')} testID="wallet-tx-empty" />
          )
        }
        ListFooterComponent={txs.isFetchingNextPage ? <ActivityIndicator color={colors.primary} style={styles.more} /> : undefined}
        contentContainerStyle={styles.list}
        testID="wallet-list"
      />
      <TopUpSheet visible={sheet.open} initialAmount={sheet.amount} onClose={() => setSheet({ open: false, amount: null })} />
    </Screen>
  );
}

function TxRow({ tx }: { tx: LedgerTxView }) {
  const { t, locale } = useT();
  const ref = tx.requestNumber
    ? t('wallet.request', { number: formatRequestNumber(tx.requestNumber) })
    : tx.projectNumber
      ? t('wallet.project', { number: formatRequestNumber(tx.projectNumber) })
      : null;
  return (
    <View style={styles.tx} testID={`wallet-tx-${tx.id}`}>
      <View style={styles.flex}>
        <AppText variant="bodyStrong">{t(`common:ledgerTxKind.${tx.kind}`)}</AppText>
        <AppText variant="caption" color="textMuted">
          {[formatDateTime(tx.createdAt), ref].filter(Boolean).join(' · ')}
        </AppText>
      </View>
      <View style={styles.amount}>
        <AppText variant="bodyStrong" color={tx.amount < 0 ? 'danger' : 'primaryDark'} testID={`wallet-tx-amount-${tx.id}`}>
          {formatMoney(tx.amount, locale, { sign: true })}
        </AppText>
        <AppText variant="caption" color="textMuted">
          {formatMoney(tx.balanceAfter, locale)}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { paddingBottom: spacing.xxl, flexGrow: 1 },
  block: { marginBottom: spacing.md },
  section: { marginTop: spacing.sm, marginBottom: spacing.sm },
  topUp: { marginTop: spacing.md },
  more: { marginVertical: spacing.md },
  tx: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  amount: { alignItems: 'flex-end', marginLeft: spacing.md },
});
