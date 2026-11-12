import React from 'react';
import { StyleSheet, View } from 'react-native';
import { formatDateTime, formatRequestNumber, type RequestSummary } from '@tezfiks/shared';
import { AppText, Card, StatusPill, spacing, useT } from '@tezfiks/mobile';
import { requestStatusTone } from '../lib/orders';
import { CategoryIcon } from './CategoryIcon';

/** One order in the Sifarişlər list: service, number, status, time, address and how many handymen were found. */
export function RequestCard({ request, onPress }: { request: RequestSummary; onPress: (r: RequestSummary) => void }) {
  const { t } = useT();
  const when = request.timing === 'SCHEDULED' && request.scheduledAt ? request.scheduledAt : request.createdAt;
  return (
    <Card onPress={() => onPress(request)} style={styles.card} testID={`request-card-${request.id}`}>
      <View style={styles.top}>
        <CategoryIcon icon={request.category.icon} size={18} />
        <View style={styles.title}>
          <AppText variant="bodyStrong" numberOfLines={1}>
            {request.category.name}
          </AppText>
          <AppText variant="caption" color="textMuted">
            {formatRequestNumber(request.number)} · {formatDateTime(when)}
            {request.timing !== 'NOW' ? ` · ${t(`common:timing.${request.timing}`)}` : ''}
          </AppText>
        </View>
        <StatusPill label={t(`common:requestStatus.${request.status}`)} tone={requestStatusTone(request.status)} testID={`request-status-${request.id}`} />
      </View>
      {request.descriptionShort ? (
        <AppText variant="small" numberOfLines={2} style={styles.line}>
          {request.descriptionShort}
        </AppText>
      ) : null}
      <AppText variant="caption" color="textMuted" numberOfLines={1} style={styles.line}>
        {request.addressText}
      </AppText>
      {request.slotsRequested > 1 ? (
        <AppText variant="caption" color="textMuted" style={styles.line}>
          {t('orders.slotsFilled', { filled: request.slotsFilled, total: request.slotsRequested })}
        </AppText>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.sm },
  top: { flexDirection: 'row', alignItems: 'center' },
  title: { flex: 1, marginHorizontal: spacing.sm },
  line: { marginTop: spacing.xs },
});
