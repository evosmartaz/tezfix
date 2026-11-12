import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type PayoutMethodType } from '@tezfiks/shared';
import { AppText, Button, Header, Screen, Segmented, TextField, errorMessage, spacing, useApi, useT, useToast } from '@tezfiks/mobile';
import { qk } from '../hooks/queries';
import { formatCardNumber, formatIban, sanitizeCardNumber, sanitizeIban, validatePayoutForm, type PayoutField } from '../lib/payout';

function back() {
  if (router.canGoBack()) router.back();
  else router.replace('/earnings' as never);
}

/** Payout card / IBAN (spec 4.9): the server keeps only a masked copy. */
export default function PayoutMethod() {
  const { t } = useT();
  const client = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ companyId?: string }>();
  const companyId = typeof params.companyId === 'string' && params.companyId ? params.companyId : null;
  const current = useQuery({
    queryKey: qk.payoutMethod(companyId),
    queryFn: () => (companyId ? client.call(api.company.getPayoutMethod, { params: { companyId } }) : client.call(api.pro.getPayoutMethod)),
  });
  const [type, setType] = useState<PayoutMethodType>('CARD');
  const [number, setNumber] = useState('');
  const [holder, setHolder] = useState('');
  const [errors, setErrors] = useState<Partial<Record<PayoutField, string>>>({});
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const v = validatePayoutForm({ type, number, holderName: holder });
    if (!v.body) {
      setErrors(Object.fromEntries(Object.entries(v.errors).map(([k, e]) => [k, t(`payout.errors.${e}`)])));
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      if (companyId) await client.call(api.company.setPayoutMethod, { params: { companyId }, body: v.body });
      else await client.call(api.pro.setPayoutMethod, { body: v.body });
      toast.show(t('payout.saved'), { kind: 'success' });
      void queryClient.invalidateQueries({ queryKey: qk.earnings(companyId) });
      back();
    } catch (err) {
      toast.show(errorMessage(t, err), { kind: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const m = current.data?.method;
  return (
    <Screen scroll testID="payout-screen" footer={<Button title={t('payout.save')} onPress={() => void save()} loading={saving} testID="payout-save" />}>
      <Header title={t('payout.title')} subtitle={t('payout.subtitle')} onBack={back} />
      {m ? (
        <AppText variant="small" color="textMuted" style={styles.block} testID="payout-current">
          {t('payout.current', { masked: m.maskedNumber, holder: m.holderName })}
        </AppText>
      ) : null}
      <View style={styles.block}>
        <Segmented<PayoutMethodType>
          options={[
            { value: 'CARD', label: t('payout.card') },
            { value: 'IBAN', label: t('payout.iban') },
          ]}
          value={type}
          onChange={(v) => {
            setType(v);
            setNumber('');
            setErrors({});
          }}
          testID="payout-type"
        />
      </View>
      <TextField
        label={type === 'CARD' ? t('payout.cardNumber') : t('payout.ibanNumber')}
        value={type === 'CARD' ? formatCardNumber(number) : formatIban(number)}
        onChangeText={(v) => setNumber(type === 'CARD' ? sanitizeCardNumber(v) : sanitizeIban(v))}
        keyboardType={type === 'CARD' ? 'number-pad' : 'default'}
        autoCapitalize="characters"
        error={errors.number}
        testID="payout-number"
      />
      <TextField label={t('payout.holder')} value={holder} onChangeText={setHolder} error={errors.holderName} testID="payout-holder" />
      <AppText variant="caption" color="textMuted">
        {t('payout.hint')}
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({ block: { marginBottom: spacing.md } });
