import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { ProviderPublic } from '@tezfiks/shared';
import { AppText, Avatar, Stars, spacing, useT } from '@tezfiks/mobile';

/** Board 02 B5 provider card: photo, full name, trade, rating, completed jobs, company (never the phone). */
export function ProviderCard({ provider, right, testID = 'provider-card' }: { provider: ProviderPublic; right?: React.ReactNode; testID?: string }) {
  const { t } = useT();
  const name = `${provider.firstName} ${provider.lastName}`.trim();
  const trade = provider.trades[0];
  return (
    <View style={styles.row} testID={testID}>
      <Avatar uri={provider.photo?.url} firstName={provider.firstName} lastName={provider.lastName} size={52} />
      <View style={styles.text}>
        <AppText variant="h3" testID={`${testID}-name`}>
          {name}
        </AppText>
        <AppText variant="caption" color="textMuted">
          {[trade, t('detail.jobs', { count: provider.completedCount })].filter(Boolean).join(' • ')}
        </AppText>
        {provider.company ? (
          <AppText variant="caption" color="textMuted">
            {provider.company.name}
          </AppText>
        ) : null}
      </View>
      {provider.ratingAvg !== null ? <Stars value={provider.ratingAvg} size={12} showValue testID={`${testID}-rating`} /> : null}
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  text: { flex: 1, marginHorizontal: spacing.md },
});
