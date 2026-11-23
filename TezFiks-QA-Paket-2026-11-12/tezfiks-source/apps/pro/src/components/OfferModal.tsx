import React from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatDateTime, formatMoney, shortName, type OfferView } from '@tezfiks/shared';
import { AppText, Badge, Banner, Button, Countdown, ModalToastHost, colors, radii, shadows, spacing, useT } from '@tezfiks/mobile';
import { distanceKm, offerWindowSec } from '../lib/offers';

export interface OfferModalProps {
  offer: OfferView | null;
  waiting: number;
  accepting: boolean;
  /** Failed accept of this offer: shown inside the modal (it is drawn above the toast host). */
  error?: { code: string; message: string } | null;
  onAccept: (offer: OfferView) => void;
  onDecline: (offer: OfferView) => void;
  /** "Balansı artır" next to an insufficient balance error. */
  onTopUp?: () => void;
}

function Row({ label, value, testID }: { label: string; value: string; testID?: string }) {
  return (
    <View style={styles.rowBlock}>
      <AppText variant="caption" color="textMuted">
        {label}
      </AppText>
      <AppText variant="bodyStrong" testID={testID}>
        {value}
      </AppText>
    </View>
  );
}

/**
 * Board 03 B2 "Yeni sifariş!": countdown from `expiresAt` (server-clock corrected), service, address area,
 * distance/ETA, customer first name + initial + rating, TƏCİLİ badge, fee warning, İmtina et / Qəbul et.
 * No phone and no exact address (spec §4.4).
 */
export function OfferModal({ offer, waiting, accepting, error, onAccept, onDecline, onTopUp }: OfferModalProps) {
  const { t, locale } = useT();
  const insets = useSafeAreaInsets();
  if (!offer) return null;
  const km = distanceKm(offer.distanceM);
  const distance = [
    km !== null ? t('offer.km', { km: locale === 'en' ? km.toFixed(1) : km.toFixed(1).replace('.', ',') }) : null,
    offer.etaMin !== null ? t('offer.eta', { min: offer.etaMin }) : null,
  ]
    .filter(Boolean)
    .join(' • ');
  const rating = offer.customer.ratingAvg !== null ? ` • ★ ${offer.customer.ratingAvg.toFixed(1)}` : '';
  const customer = `${shortName(offer.customer.firstName, offer.customer.lastInitial)}${rating}`;
  const service = offer.descriptionShort ? `${offer.category.name} — ${offer.descriptionShort}` : offer.category.name;

  return (
    <Modal visible transparent animationType="slide" statusBarTranslucent onRequestClose={() => undefined}>
      <View style={styles.backdrop} testID="offer-modal">
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={styles.topRow}>
            <View style={styles.timerPill}>
              <Countdown
                deadline={offer.expiresAt}
                totalSec={offerWindowSec(offer)}
                format="seconds"
                render={(left) => t('offer.countdown', { count: left })}
                variant="small"
                color="danger"
                testID="offer-countdown"
              />
            </View>
            {offer.isEmergency ? <Badge label={t('offer.emergency')} tone="danger" testID="offer-emergency" /> : null}
          </View>
          <AppText variant="h1" style={styles.title}>
            {t('offer.newTitle')}
          </AppText>
          <AppText variant="small" color="textMuted">
            {t('offer.number', { number: offer.requestNumber })}
            {waiting > 0 ? ` · ${t('offer.waiting', { count: waiting })}` : ''}
          </AppText>
          <Row label={t('offer.service')} value={service} testID="offer-service" />
          <Row label={t('offer.address')} value={offer.address.area} testID="offer-address" />
          {distance ? <Row label={t('offer.distance')} value={distance} testID="offer-distance" /> : null}
          <Row label={t('offer.customer')} value={customer} testID="offer-customer" />
          {offer.timing === 'SCHEDULED' && offer.scheduledAt ? (
            <Row label={t('offer.scheduledAt')} value={formatDateTime(offer.scheduledAt)} />
          ) : null}
          <View style={styles.feeBox} testID="offer-fee">
            <AppText variant="small" style={styles.feeText}>
              {t('offer.feeWarning', { fee: formatMoney(offer.fee, locale, { compact: true, plain: true }) })}
            </AppText>
          </View>
          {error ? (
            <View style={styles.error}>
              <Banner tone="danger" icon="alert-circle-outline" message={error.message} testID="offer-error" />
              {error.code === 'INSUFFICIENT_BALANCE' && onTopUp ? (
                <Button variant="dark" size="sm" title={t('home.topUp')} onPress={onTopUp} disabled={accepting} testID="offer-topup" />
              ) : null}
            </View>
          ) : null}
          <View style={styles.actions}>
            <Button
              variant="outline"
              title={t('offer.decline')}
              onPress={() => onDecline(offer)}
              disabled={accepting}
              style={styles.action}
              fullWidth={false}
              testID="offer-decline"
            />
            <Button
              title={t('offer.accept')}
              onPress={() => onAccept(offer)}
              loading={accepting}
              style={styles.action}
              fullWidth={false}
              testID="offer-accept"
            />
          </View>
        </View>
        {/* The modal covers the root toast host: e.g. "already taken" stays visible while the next offer is shown. */}
        <ModalToastHost />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    ...shadows.sheet,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  timerPill: { backgroundColor: colors.dangerSoft, borderRadius: radii.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, minWidth: 160 },
  title: { marginTop: spacing.lg },
  rowBlock: { marginTop: spacing.md },
  feeBox: { marginTop: spacing.lg, backgroundColor: colors.accentSoft, borderRadius: radii.md, borderWidth: 1, borderColor: colors.accent, padding: spacing.md },
  feeText: { color: colors.accentText },
  error: { marginTop: spacing.md },
  actions: { flexDirection: 'row', marginTop: spacing.lg },
  action: { flex: 1, marginHorizontal: spacing.xs },
});
