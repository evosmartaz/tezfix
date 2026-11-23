import React, { useRef, useState } from 'react';
import { Image, Linking, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatDate, formatMoney, formatPhone, shortName, type ProAssignment } from '@tezfiks/shared';
import {
  AppText,
  Avatar,
  Badge,
  BottomSheet,
  Button,
  Card,
  TextField,
  colors,
  formatCountdown,
  newIdempotencyKey,
  openNavigation,
  openWaze,
  radii,
  spacing,
  useT,
} from '@tezfiks/mobile';
import { addressDetails, cancelInfo, navigationTargets, statusTone, type JobVisibility } from '../lib/jobs';

/** Status pill of an assignment ("Yoldadır", "Tamamlandı" ...). */
export function JobStatusBadge({ job, testID = 'job-status' }: { job: Pick<ProAssignment, 'status'>; testID?: string }) {
  const { t } = useT();
  return <Badge label={t(`common:assignmentStatus.${job.status}`)} tone={statusTone(job.status)} testID={testID} />;
}

/**
 * Customer card (board 03 B3): photo + first name and initial; rating, phone and chat only where the viewer may see
 * them (spec 4.4). Before contact unlock the phone/chat row explains when it opens.
 */
export function CustomerCard({
  job,
  visibility,
  limited,
  onChat,
}: {
  job: ProAssignment;
  visibility: JobVisibility;
  limited: boolean;
  onChat?: () => void;
}) {
  const { t } = useT();
  const c = job.customer;
  const name = shortName(c.firstName, c.lastInitial);
  const sub = [c.type === 'COMPANY' && c.companyName ? c.companyName : null, visibility.customerRating && c.ratingAvg !== null ? `★ ${c.ratingAvg.toFixed(1)}` : null]
    .filter(Boolean)
    .join(' • ');
  const phone = visibility.customerPhone ? job.customerPhone : null;
  return (
    <Card style={styles.block} testID="job-customer">
      <View style={styles.row}>
        <Avatar uri={c.photo?.url} firstName={c.firstName} lastName={c.lastInitial} size={48} />
        <View style={styles.flexText}>
          <AppText variant="caption" color="textMuted">
            {t('job.customer')}
          </AppText>
          <AppText variant="bodyStrong" testID="job-customer-name">
            {name}
          </AppText>
          {sub ? (
            <AppText variant="small" color="textMuted" testID="job-customer-sub">
              {sub}
            </AppText>
          ) : null}
        </View>
      </View>
      {!limited && phone ? (
        // The number on a line of its own: inside the call button it was cut off ("Zəng et · 050 1…").
        <View style={[styles.row, styles.phoneRow]}>
          <Ionicons name="call-outline" size={18} color={colors.primary} />
          <View style={styles.phoneText}>
            <AppText variant="caption" color="textMuted">
              {t('job.customerPhone')}
            </AppText>
            <AppText variant="bodyStrong" selectable testID="job-customer-phone">
              {formatPhone(phone)}
            </AppText>
          </View>
        </View>
      ) : null}
      {limited ? null : phone || visibility.chat ? (
        <View style={[styles.row, styles.actions]}>
          {phone ? (
            <Button
              variant="secondary"
              size="sm"
              title={t('job.call')}
              onPress={() => void Linking.openURL(`tel:${phone}`)}
              fullWidth={false}
              style={styles.action}
              accessibilityHint={formatPhone(phone)}
              testID="job-call"
            />
          ) : null}
          {visibility.chat && onChat ? (
            <Button variant="outline" size="sm" title={t('job.openChat')} onPress={onChat} fullWidth={false} style={styles.action} testID="job-chat" />
          ) : null}
        </View>
      ) : (
        <AppText variant="small" color="textMuted" style={styles.line} testID="job-contact-locked">
          {t('job.contactLocked')}
        </AppText>
      )}
    </Card>
  );
}

/** Address with flat details (after acceptance the provider sees the full address, spec 4.4). */
export function AddressBlock({ job, testID = 'job-address' }: { job: ProAssignment; testID?: string }) {
  const { t } = useT();
  const details = addressDetails(job.address, {
    block: t('job.addressParts.block'),
    entrance: t('job.addressParts.entrance'),
    floor: t('job.addressParts.floor'),
    apartment: t('job.addressParts.apartment'),
    intercom: t('job.addressParts.intercom'),
  });
  return (
    <View>
      <AppText variant="caption" color="textMuted">
        {t('job.address')}
      </AppText>
      <AppText variant="bodyStrong" testID={testID}>
        {job.address.formatted}
      </AppText>
      {details ? (
        <AppText variant="small" testID={`${testID}-details`}>
          {details}
        </AppText>
      ) : null}
      {job.address.note ? (
        <AppText variant="small" color="textMuted">
          {t('job.addressNote', { note: job.address.note })}
        </AppText>
      ) : null}
    </View>
  );
}

/** Board 04 "Google Maps / Waze / Paylaş". */
export function NavButtons({ job, title }: { job: ProAssignment; title?: string }) {
  const { t } = useT();
  const n = navigationTargets(job.address, title);
  const items: Array<{ key: string; label: string; icon: React.ComponentProps<typeof Ionicons>['name']; onPress: () => void }> = [
    { key: 'google', label: t('job.nav.google'), icon: 'navigate-outline', onPress: () => void openNavigation(job.address.lat, job.address.lng) },
    { key: 'waze', label: t('job.nav.waze'), icon: 'car-outline', onPress: () => void openWaze(job.address.lat, job.address.lng).catch(() => Linking.openURL(n.web)) },
    { key: 'share', label: t('job.nav.share'), icon: 'share-outline', onPress: () => void Share.share({ message: n.shareMessage }).catch(() => undefined) },
  ];
  return (
    <View style={[styles.row, styles.block]} testID="job-nav">
      {items.map((it) => (
        <Pressable key={it.key} onPress={it.onPress} style={styles.navTile} accessibilityRole="button" testID={`job-nav-${it.key}`}>
          <Ionicons name={it.icon} size={20} color={colors.text} />
          <AppText variant="small" style={styles.navLabel}>
            {it.label}
          </AppText>
        </Pressable>
      ))}
    </View>
  );
}

/** Description and problem photos (FULL views only). */
export function DescriptionBlock({ job }: { job: ProAssignment }) {
  const { t } = useT();
  if (!job.description && !job.photos.length) return null;
  return (
    <View style={styles.line} testID="job-description-block">
      <AppText variant="caption" color="textMuted">
        {t('job.description')}
      </AppText>
      {job.description ? (
        <AppText variant="body" testID="job-description">
          {job.description}
        </AppText>
      ) : null}
      {job.photos.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.line}>
          {job.photos.map((p) => (
            <Image key={p.id} source={{ uri: p.url }} style={styles.photo} testID={`job-photo-${p.id}`} />
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

/** Final price, payment, tip, guarantee and fee (FULL views; never for company workers). */
export function MoneyBlock({ job, visibility }: { job: ProAssignment; visibility: JobVisibility }) {
  const { t, locale } = useT();
  const price = visibility.price ? job.price : null;
  const fee = visibility.fee ? job.fee : null;
  if (!price && !fee) return null;
  const feeState = fee ? (fee.refunded ? 'refunded' : fee.captured ? 'captured' : 'held') : null;
  return (
    <Card style={styles.block} testID="job-money">
      {price ? (
        <View testID="job-price">
          <View style={styles.row}>
            <AppText variant="bodyStrong" style={styles.flex}>
              {t('job.price')}
            </AppText>
            <AppText variant="h3" color="primary" testID="job-price-total">
              {formatMoney(price.total, locale)}
            </AppText>
          </View>
          <AppText variant="small" color="textMuted">
            {t('job.priceLine', { labor: formatMoney(price.labor, locale), materials: formatMoney(price.materials, locale) })}
          </AppText>
          {job.paymentMethod ? (
            <AppText variant="small" style={styles.line}>
              {t('job.paymentMethod', { method: t(`common:paymentMethod.${job.paymentMethod}`) })}
            </AppText>
          ) : null}
          {job.paymentStatus && job.paymentStatus !== 'SUCCEEDED' ? (
            <AppText variant="small" color={job.paymentStatus === 'CREATED' ? 'textMuted' : 'danger'} testID="job-payment-status">
              {t(`common:paymentStatus.${job.paymentStatus}`)}
            </AppText>
          ) : null}
          {job.tipAmount ? (
            <AppText variant="small" color="primary">
              {t('job.tip', { amount: formatMoney(job.tipAmount, locale) })}
            </AppText>
          ) : null}
          {job.guaranteeUntil ? (
            <AppText variant="small" color="textMuted">
              {t('job.guaranteeUntil', { date: formatDate(job.guaranteeUntil) })}
            </AppText>
          ) : null}
        </View>
      ) : null}
      {fee ? (
        <AppText variant="small" color="textMuted" style={price ? styles.line : undefined} testID="job-fee">
          {`${t('job.fee', { amount: formatMoney(fee.amount, locale, { compact: true }) })} · ${t(`job.feeState.${feeState}`)}`}
        </AppText>
      ) : null}
    </Card>
  );
}

/**
 * Provider cancel (spec 4.1): shows the free window countdown; after it the fee stays and a strike is added. The
 * confirmation sheet keeps one idempotency key per opening, so a double tap cannot cancel twice.
 */
export function CancelSection({
  job,
  serverNowMs,
  onCancel,
}: {
  job: ProAssignment;
  serverNowMs: number;
  onCancel: (reason: string | undefined, idempotencyKey: string) => Promise<void>;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const key = useRef<string>(newIdempotencyKey());
  const info = cancelInfo(job, serverNowMs);
  if (!info.allowed) return null;
  return (
    <View style={styles.block} testID="job-cancel-section">
      <AppText variant="small" color={info.free ? 'textMuted' : 'danger'} testID="job-cancel-info">
        {info.free ? t('job.cancel.free', { time: formatCountdown(info.freeSecondsLeft) }) : t('job.cancel.paid')}
      </AppText>
      <Button
        variant="dangerText"
        title={t('job.cancel.button')}
        onPress={() => {
          key.current = newIdempotencyKey();
          setOpen(true);
        }}
        testID="job-cancel"
      />
      <BottomSheet visible={open} onClose={() => setOpen(false)} title={t('job.cancel.title')} testID="job-cancel-sheet">
        <AppText variant="body" testID="job-cancel-body">
          {info.free ? t('job.cancel.bodyFree') : t('job.cancel.bodyPaid')}
        </AppText>
        <View style={styles.line}>
          <TextField label={t('job.cancel.reason')} value={reason} onChangeText={setReason} maxLength={300} testID="job-cancel-reason" />
        </View>
        <View style={styles.row}>
          <Button variant="outline" title={t('job.cancel.keep')} onPress={() => setOpen(false)} fullWidth={false} style={styles.action} testID="job-cancel-keep" />
          <Button
            variant="danger"
            title={t('job.cancel.confirm')}
            loading={busy}
            fullWidth={false}
            style={styles.action}
            onPress={async () => {
              setBusy(true);
              try {
                await onCancel(reason.trim() || undefined, key.current);
                setOpen(false);
              } finally {
                setBusy(false);
              }
            }}
            testID="job-cancel-confirm"
          />
        </View>
      </BottomSheet>
    </View>
  );
}

export const jobStyles = StyleSheet.create({
  block: { marginTop: spacing.md },
  line: { marginTop: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
});

const styles = StyleSheet.create({
  block: { marginTop: spacing.md },
  line: { marginTop: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  flexText: { flex: 1, marginLeft: spacing.md },
  actions: { marginTop: spacing.md },
  action: { flex: 1, marginHorizontal: spacing.xs },
  phoneRow: { marginTop: spacing.md },
  phoneText: { flex: 1, marginLeft: spacing.sm },
  navTile: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.md,
    marginHorizontal: spacing.xs,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  navLabel: { marginTop: spacing.xs },
  photo: { width: 88, height: 88, borderRadius: radii.md, marginRight: spacing.sm, backgroundColor: colors.border },
});
