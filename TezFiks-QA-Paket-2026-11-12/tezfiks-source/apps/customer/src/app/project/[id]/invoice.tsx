import React from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { formatDate, formatMoney, formatRequestNumber } from '@tezfiks/shared';
import { AppText, Banner, Card, ErrorState, Header, LoadingState, Screen, StatusPill, colors, spacing, useT } from '@tezfiks/mobile';
import { useProject } from '../../../data/queries';

/** Hesab-faktura of a completed B2B project: issuer and customer (VÖEN), lines, subtotal, VAT, total, status. */
export default function InvoiceRoute() {
  const { t, locale } = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useProject(id);
  const back = () => (router.canGoBack() ? router.back() : router.replace(`/project/${id}` as never));

  if (q.isPending) return <LoadingState testID="invoice-loading" />;
  const inv = q.data?.invoice;
  if (q.isError || !inv) {
    return (
      <Screen testID="invoice-screen">
        <Header onBack={back} />
        <ErrorState error={q.error} message={q.isError ? undefined : t('invoice.missing')} onRetry={() => void q.refetch()} />
      </Screen>
    );
  }

  return (
    <Screen scroll edges={['top', 'bottom']} testID="invoice-screen">
      <Header
        onBack={back}
        title={t('invoice.title', { number: inv.number })}
        right={<StatusPill label={t(`common:invoiceStatus.${inv.status}`)} tone={inv.status === 'PAID' ? 'success' : inv.status === 'VOID' ? 'neutral' : 'warning'} testID="invoice-status" />}
      />
      <Card style={styles.block}>
        <AppText variant="caption" color="textMuted">
          {t('invoice.issuedAt', { date: formatDate(inv.issuedAt) })} · {t('wallet.project', { number: formatRequestNumber(inv.projectNumber) })}
        </AppText>
        <Party title={t('invoice.issuer')} name={inv.issuer.name} voen={inv.issuer.voen} />
        <Party title={t('invoice.customer')} name={inv.customer.name} voen={inv.customer.voen} />
      </Card>
      <Card style={styles.block} testID="invoice-lines">
        <AppText variant="bodyStrong" style={styles.head}>
          {t('invoice.lines')}
        </AppText>
        {inv.lines.map((l, i) => (
          <Row key={i} label={l.description} value={formatMoney(l.amount, locale)} />
        ))}
        <View style={styles.divider} />
        <Row label={t('invoice.subtotal')} value={formatMoney(inv.subtotal, locale)} testID="invoice-subtotal" />
        {inv.issuer.isVatPayer ? (
          <Row label={t('invoice.vat', { rate: inv.vatRatePercent })} value={formatMoney(inv.vatAmount, locale)} testID="invoice-vat" />
        ) : (
          <AppText variant="caption" color="textMuted" testID="invoice-no-vat">
            {t('invoice.noVat')}
          </AppText>
        )}
        <View style={styles.divider} />
        <Row label={t('invoice.total')} value={formatMoney(inv.total, locale)} strong testID="invoice-total" />
      </Card>
      {inv.paidAt ? (
        <Banner tone="success" message={t('invoice.paidAt', { date: formatDate(inv.paidAt) })} testID="invoice-paid" />
      ) : (
        <Banner tone="info" message={t('invoice.payNote')} testID="invoice-pay-note" />
      )}
    </Screen>
  );
}

function Party({ title, name, voen }: { title: string; name: string; voen: string | null }) {
  const { t } = useT();
  return (
    <View style={styles.party}>
      <AppText variant="caption" color="textMuted">
        {title}
      </AppText>
      <AppText variant="bodyStrong">{name}</AppText>
      {voen ? (
        <AppText variant="small" color="textMuted">
          {t('invoice.voen', { voen })}
        </AppText>
      ) : null}
    </View>
  );
}

function Row({ label, value, strong, testID }: { label: string; value: string; strong?: boolean; testID?: string }) {
  return (
    <View style={styles.row}>
      <AppText variant={strong ? 'bodyStrong' : 'body'} style={styles.flex}>
        {label}
      </AppText>
      <AppText variant={strong ? 'h3' : 'bodyStrong'} testID={testID}>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  block: { marginBottom: spacing.md },
  head: { marginBottom: spacing.sm },
  party: { marginTop: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.xs },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
});
