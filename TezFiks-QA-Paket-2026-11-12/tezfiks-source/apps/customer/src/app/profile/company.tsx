import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { api, LegalForm, type CustomerType } from '@tezfiks/shared';
import { AppText, Button, Card, ErrorState, Header, LoadingState, Screen, Segmented, TextField, colors, errorMessage, spacing, useRuntime, useT, useToast } from '@tezfiks/mobile';
import { qk, useCustomerAccount } from '../../data/queries';
import {
  accountFormFromAccount,
  buildAccountBody,
  hasErrors,
  sanitizeVoenInput,
  validateAccountForm,
  type AccountFormErrors,
  type AccountFormValues,
} from '../../lib/accountForm';

/** Account type and company details (name, VÖEN, legal form, contact person) — POST /customer/account. */
export default function CompanyInfoRoute() {
  const { t } = useT();
  const runtime = useRuntime();
  const toast = useToast();
  const queryClient = useQueryClient();
  const account = useCustomerAccount();
  const [form, setForm] = useState<AccountFormValues | null>(null);
  const [errors, setErrors] = useState<AccountFormErrors>({});
  const [saving, setSaving] = useState(false);
  const back = () => (router.canGoBack() ? router.back() : router.replace('/profile'));

  useEffect(() => {
    // `null` (no account yet) is a loaded answer too: the form starts empty.
    if (account.data !== undefined && !form) setForm(accountFormFromAccount(account.data));
  }, [account.data, form]);

  if (!form) {
    if (account.isError) {
      return (
        <Screen testID="company-screen">
          <Header onBack={back} title={t('profile.company')} />
          <ErrorState error={account.error} onRetry={() => void account.refetch()} testID="company-error" />
        </Screen>
      );
    }
    return <LoadingState testID="company-loading" />;
  }

  const set = <K extends keyof AccountFormValues>(k: K, v: AccountFormValues[K]) => {
    setForm((f) => (f ? { ...f, [k]: v } : f));
    if (k in errors) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const save = async () => {
    const next = validateAccountForm(form);
    setErrors(next);
    if (hasErrors(next)) return;
    setSaving(true);
    try {
      const acc = await runtime.api.call(api.customer.upsertAccount, { body: buildAccountBody(form) });
      queryClient.setQueryData(qk.account, acc);
      const fresh = await runtime.api.call(api.me.get);
      runtime.auth.getState().setMe(fresh);
      toast.show(t('profile.companySaved'), { kind: 'success' });
      back();
    } catch (err) {
      if ((err as { code?: string })?.code === 'CONFLICT') setErrors((e) => ({ ...e, voen: 'account.errors.voenTaken' }));
      toast.show(errorMessage(t, err), { kind: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen scroll edges={['top', 'bottom']} testID="company-screen" footer={<Button title={t('common:actions.save')} onPress={() => void save()} loading={saving} testID="company-save" />}>
      <Header title={t('profile.company')} onBack={back} />
      <Segmented
        options={(['INDIVIDUAL', 'COMPANY'] as CustomerType[]).map((v) => ({ value: v, label: t(`common:customerType.${v}`) }))}
        value={form.type}
        onChange={(v) => set('type', v)}
        testID="company-type"
      />
      <View style={styles.gap} />
      {form.type === 'COMPANY' ? (
        <Card testID="company-fields">
          <TextField label={t('common:fields.companyName')} value={form.companyName} onChangeText={(v) => set('companyName', v)} maxLength={120} error={errors.companyName ? t(errors.companyName) : null} testID="company-name" />
          <TextField
            label={t('common:fields.voen')}
            value={form.voen}
            onChangeText={(v) => set('voen', sanitizeVoenInput(v))}
            keyboardType="number-pad"
            maxLength={10}
            hint={t('account.voenHint')}
            error={errors.voen ? t(errors.voen) : null}
            testID="company-voen"
          />
          <AppText variant="small" color="textMuted" style={styles.label}>
            {t('common:fields.legalForm')}
          </AppText>
          <View style={styles.chips}>
            {LegalForm.values.map((lf) => {
              const on = form.legalForm === lf;
              return (
                <Pressable key={lf} onPress={() => set('legalForm', lf)} style={[styles.chip, on && styles.chipOn]} accessibilityRole="radio" accessibilityState={{ selected: on }} testID={`company-legal-${lf}`}>
                  <AppText variant="small">{t(`common:legalForm.${lf}`)}</AppText>
                </Pressable>
              );
            })}
          </View>
          <TextField
            label={t('common:fields.contactPerson')}
            value={form.contactPerson}
            onChangeText={(v) => set('contactPerson', v)}
            maxLength={120}
            error={errors.contactPerson ? t(errors.contactPerson) : null}
            testID="company-contact"
          />
        </Card>
      ) : (
        <AppText variant="body" color="textMuted">
          {t('account.individualHint')}
        </AppText>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  gap: { height: spacing.md },
  label: { marginBottom: spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.md },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  chipOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
});
