import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { Card, Header, ListItem, Screen, Segmented, colors, spacing, useT } from '@tezfiks/mobile';
import { JobList, type JobScope } from '../../components/JobList';
import { useProProfile } from '../../hooks/queries';
import { useProMode } from '../../hooks/useProMode';

/** Orders: personal jobs (active / history) with "Planlı sifarişlər", or the company's jobs in manager mode. */
export default function ProOrders() {
  const { t } = useT();
  const queryClient = useQueryClient();
  const profile = useProProfile();
  const mode = useProMode(profile.data);
  const [scope, setScope] = useState<JobScope>('active');
  const pro = profile.data?.profile ?? null;
  const solo = pro?.kind === 'SOLO' && pro.status === 'APPROVED';
  const companyId = mode.kind === 'company' ? mode.companyId : null;
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: companyId ? ['company', companyId, 'assignments'] : ['pro', 'assignments'] });
  };
  return (
    <Screen scroll edges={['top']} testID="orders-screen" onRefresh={refresh} refreshing={false}>
      <Header title={companyId ? t('orders.companyTitle') : t('tabs.orders')} />
      {!companyId && solo ? (
        <Card padded={false} style={styles.block}>
          <ListItem
            title={t('scheduled.title')}
            subtitle={t('scheduled.subtitle')}
            left={<Ionicons name="calendar-outline" size={22} color={colors.primary} />}
            chevron
            divider={false}
            onPress={() => router.push('/scheduled')}
            testID="orders-scheduled"
          />
        </Card>
      ) : null}
      <View style={styles.block}>
        <Segmented<JobScope>
          options={[
            { value: 'active', label: t('orders.active') },
            { value: 'history', label: t('orders.history') },
          ]}
          value={scope}
          onChange={setScope}
          testID="orders-scope"
        />
      </View>
      {pro || companyId ? <JobList key={`${companyId ?? 'self'}-${scope}`} scope={scope} companyId={companyId} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  block: { marginBottom: spacing.md },
});
