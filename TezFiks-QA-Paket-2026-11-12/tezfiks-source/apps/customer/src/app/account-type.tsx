import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { api, LegalForm, type CustomerType } from '@tezfiks/shared';
import { AppText, Button, Card, Header, Screen, TextField, colors, errorMessage, spacing, useAuth, useRuntime, useT } from '@tezfiks/mobile';
import {
  buildAccountBody,
  emptyAccountForm,
  hasErrors,
  sanitizeVoenInput,
  validateAccountForm,
  type AccountFormErrors,
  type AccountFormValues,
} from '../lib/accountForm';
import { qk } from '../data/queries';

/**
 * Board 02 A3 "Hesab tipini seçin": Fərdi hesab, or Şirkət hesabı with company name, VÖEN, legal form and contact person.
 * Creates the customer account (POST /customer/account), then reloads /me so the entry gate opens the tabs.
 */
export default function AccountTypeRoute() {
  const { t } = useT();
  const runtime = useRuntime();
  const queryClient = useQueryClient();
  const status = useAuth((s) => s.status);
  const me = useAuth((s) => s.me);
  const [form, setForm] = useState<AccountFormValues>(() =>
    emptyAccountForm([me?.firstName, me?.lastName].filter(Boolean).join(' ')),
  );
  const [errors, setErrors] = useState<AccountFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof AccountFormValues>(k: K, v: AccountFormValues[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (k in errors) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const submit = async () => {
    const next = validateAccountForm(form);
    setErrors(next);
    setFormError(null);
    if (hasErrors(next)) return;
    setSaving(true);
    try {
      const account = await runtime.api.call(api.customer.upsertAccount, { body: buildAccountBody(form) });
      queryClient.setQueryData(qk.account, account);
      const fresh = await runtime.api.call(api.me.get);
      runtime.auth.getState().setMe(fresh);
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === 'CONFLICT') setErrors((e) => ({ ...e, voen: 'account.errors.voenTaken' }));
      setFormError(errorMessage(t, err));
    } finally {
      setSaving(false);
    }
  };

  const typeCard = (type: CustomerType, icon: React.ComponentProps<typeof Ionicons>['name']) => {
    const selected = form.type === type;
    return (
      <Card
        selected={selected}
        onPress={() => set('type', type)}
        style={styles.typeCard}
        testID={`account-type-${type}`}
        accessibilityLabel={t(`common:customerType.${type}`)}
      >
        <View style={styles.typeRow}>
          <View style={styles.typeIcon}>
            <Ionicons name={icon} size={22} color={colors.primaryDark} />
          </View>
          <View style={styles.flex}>
            <AppText variant="bodyStrong">{t(`common:customerType.${type}`)}</AppText>
            <AppText variant="caption" color="textMuted">
              {t(type === 'INDIVIDUAL' ? 'account.individualHint' : 'account.companyHint')}
            </AppText>
          </View>
          <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={22} color={selected ? colors.primary : colors.borderStrong} />
        </View>
      </Card>
    );
  };

  return (
    <Screen
      scroll
      testID="account-type-screen"
      footer={
        <View>
          <Button title={t('account.create')} onPress={() => void submit()} loading={saving} disabled={status !== 'signedIn'} testID="account-type-submit" />
          <Button
            variant="ghost"
            title={t('common:actions.logout')}
            disabled={status !== 'signedIn'}
            onPress={() => void runtime.auth.getState().logout()}
            testID="account-type-logout"
          />
        </View>
      }
    >
      <Header large title={t('onboarding.accountTypeTitle')} subtitle={t('onboarding.accountTypeSubtitle')} />
      {typeCard('INDIVIDUAL', 'person-outline')}
      {typeCard('COMPANY', 'business-outline')}
      {form.type === 'COMPANY' ? (
        <Card style={styles.company} testID="account-company-fields">
          <AppText variant="bodyStrong" style={styles.sectionTitle}>
            {t('account.companyInfo')}
          </AppText>
          <TextField
            label={t('common:fields.companyName')}
            value={form.companyName}
            onChangeText={(v) => set('companyName', v)}
            maxLength={120}
            error={errors.companyName ? t(errors.companyName) : null}
            testID="account-company-name"
          />
          <TextField
            label={t('common:fields.voen')}
            value={form.voen}
            onChangeText={(v) => set('voen', sanitizeVoenInput(v))}
            keyboardType="number-pad"
            maxLength={10}
            error={errors.voen ? t(errors.voen) : null}
            hint={t('account.voenHint')}
            testID="account-voen"
          />
          <AppText variant="small" color="textMuted" style={styles.label}>
            {t('common:fields.legalForm')}
          </AppText>
          <View style={styles.chips}>
            {LegalForm.values.map((lf) => {
              const on = form.legalForm === lf;
              return (
                <Pressable
                  key={lf}
                  onPress={() => set('legalForm', lf)}
                  style={[styles.chip, on && styles.chipOn]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  testID={`account-legal-${lf}`}
                >
                  <AppText variant="small" style={on ? styles.chipTextOn : undefined}>
                    {t(`common:legalForm.${lf}`)}
                  </AppText>
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
            testID="account-contact"
          />
        </Card>
      ) : null}
      {formError ? (
        <AppText variant="small" color="danger" testID="account-type-error">
          {formError}
        </AppText>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  typeCard: { marginBottom: spacing.md },
  typeRow: { flexDirection: 'row', alignItems: 'center' },
  typeIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  company: { marginBottom: spacing.md },
  sectionTitle: { marginBottom: spacing.md },
  label: { marginBottom: spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.md },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  chipOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  chipTextOn: { color: colors.primaryDark, fontFamily: 'Inter_600SemiBold' },
});
