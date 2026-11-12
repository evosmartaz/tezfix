import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AppText, Card, Header, LoadingState, Screen, useT } from '@tezfiks/mobile';
import { WalletPanel } from '../../components/Wallet';
import { useProProfile } from '../../hooks/queries';
import { useProMode } from '../../hooks/useProMode';

/**
 * Balans (board 03 B5): the solo handyman's wallet, the managed company's wallet in manager mode, and an explanation
 * for company workers (they have no wallet: the company pays the fees, spec 7).
 */
export default function ProBalance() {
  const { t } = useT();
  const queryClient = useQueryClient();
  const profile = useProProfile();
  const mode = useProMode(profile.data);
  const companyId = mode.kind === 'company' ? mode.companyId : null;
  const company = companyId ? profile.data?.managedCompanies.find((c) => c.id === companyId) : null;
  const pro = profile.data?.profile ?? null;
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['wallet'] });
  };
  return (
    <Screen scroll edges={['top']} testID="balance-screen" onRefresh={refresh} refreshing={false}>
      <Header title={company ? t('balance.companyTitle', { name: company.name }) : t('tabs.balance')} />
      {profile.isLoading ? <LoadingState /> : null}
      {companyId ? <WalletPanel key={companyId} companyId={companyId} /> : null}
      {!companyId && pro?.kind === 'SOLO' ? <WalletPanel companyId={null} /> : null}
      {!companyId && pro?.kind === 'COMPANY_WORKER' ? (
        <Card testID="balance-worker">
          <AppText variant="h3">{t('balance.workerTitle')}</AppText>
          <AppText variant="body" color="textMuted">
            {t('balance.workerBody')}
          </AppText>
        </Card>
      ) : null}
    </Screen>
  );
}
