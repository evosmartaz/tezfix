import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type FinalPriceEntry } from '@tezfiks/shared';
import { AppText, Banner, Button, Card, ErrorState, Header, LoadingState, Screen, errorMessage, spacing, useApi, useT, useToast } from '@tezfiks/mobile';
import { OptionCard } from '../../../components/OptionCard';
import { qk } from '../../../hooks/queries';

/** Company settings (board 04): "Yekun qiyməti kim daxil edir?" — worker or manager (PATCH /company/:id/settings). */
export default function CompanySettings() {
  const { t } = useT();
  const client = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ companyId: string }>();
  const companyId = typeof params.companyId === 'string' ? params.companyId : '';
  const company = useQuery({ queryKey: qk.company(companyId), enabled: !!companyId, queryFn: () => client.call(api.company.get, { params: { companyId } }) });
  const [choice, setChoice] = useState<FinalPriceEntry | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (company.data && choice === null) setChoice(company.data.finalPriceEntry);
  }, [company.data, choice]);

  const dirty = !!company.data && choice !== null && choice !== company.data.finalPriceEntry;

  const save = async () => {
    if (!choice) return;
    setSaving(true);
    try {
      const updated = await client.call(api.company.updateSettings, { params: { companyId }, body: { finalPriceEntry: choice } });
      queryClient.setQueryData(qk.company(companyId), updated);
      void queryClient.invalidateQueries({ queryKey: ['company', companyId] });
      toast.show(t('company.settings.saved'), { kind: 'success' });
    } catch (err) {
      toast.show(errorMessage(t, err), { kind: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen
      scroll
      testID="company-settings-screen"
      footer={
        <View>
          {/* UX-W14: a pending change is announced next to the pinned save button. */}
          {dirty ? <Banner tone="warning" icon="alert-circle-outline" message={t('company.settings.unsaved')} testID="company-settings-unsaved" /> : null}
          <Button title={t('company.settings.save')} onPress={() => void save()} loading={saving} disabled={!choice} testID="company-settings-save" />
        </View>
      }
    >
      <Header title={t('company.settings.title')} onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
      {company.isLoading ? <LoadingState /> : null}
      {company.isError ? <ErrorState error={company.error} message={errorMessage(t, company.error)} onRetry={() => void company.refetch()} /> : null}
      {company.data ? (
        <View>
          <AppText variant="h3">{t('company.settings.priceQuestion')}</AppText>
          <AppText variant="small" color="textMuted" style={styles.intro}>
            {t('company.settings.priceIntro')}
          </AppText>
          <OptionCard
            title={t('company.settings.workerTitle')}
            subtitle={t('company.settings.workerBody')}
            selected={choice === 'WORKER'}
            onPress={() => setChoice('WORKER')}
            testID="price-entry-WORKER"
          />
          <OptionCard
            title={t('company.settings.managerTitle')}
            subtitle={t('company.settings.managerBody')}
            selected={choice === 'MANAGER'}
            onPress={() => setChoice('MANAGER')}
            testID="price-entry-MANAGER"
          />
          <Card dark style={styles.how}>
            <AppText variant="h3" color="mint">
              {t('company.settings.howTitle')}
            </AppText>
            <AppText variant="small" color="textInverse" style={styles.howText}>
              {t('company.settings.howBody')}
            </AppText>
          </Card>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { marginTop: spacing.sm, marginBottom: spacing.md },
  how: { marginTop: spacing.md },
  howText: { marginTop: spacing.xs },
});
