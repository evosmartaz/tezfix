import React, { useState } from 'react';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { api, type LegalForm } from '@tezfiks/shared';
import {
  AppText,
  Button,
  Header,
  Screen,
  Segmented,
  TextField,
  colors,
  errorCodeOf,
  errorMessage,
  spacing,
  useApi,
  useAuth,
  useT,
  useToast,
} from '@tezfiks/mobile';
import { BasePicker } from '../../components/BasePicker';
import { RadiusSlider } from '../../components/RadiusSlider';
import { TradePicker } from '../../components/TradePicker';
import { qk, useRefreshMe } from '../../hooks/queries';
import { useFieldReveal } from '../../hooks/useFieldReveal';
import { setEntryNext } from '../../lib/entry';
import { setPreferredMode } from '../../lib/mode';
import {
  COMPANY_FIELD_ORDER,
  COMPANY_MAX_TRADES,
  COMPANY_RADIUS,
  LEGAL_FORMS,
  sanitizeVoen,
  validateCompanyForm,
  type CompanyField,
  type FormErrors,
  type LatLngValue,
} from '../../lib/onboarding';

/** "Usta şirkəti": name, legal form, VÖEN, VAT payer, trades, base address, radius → POST /pro/onboarding/company, then company KYC. */
export default function CompanyOnboarding() {
  const { t } = useT();
  const client = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const refreshMe = useRefreshMe();
  const me = useAuth((s) => s.me);
  const [firstName, setFirstName] = useState(me?.firstName ?? '');
  const [lastName, setLastName] = useState(me?.lastName ?? '');
  const [name, setName] = useState('');
  const [legalForm, setLegalForm] = useState<LegalForm>('MMC');
  const [voen, setVoen] = useState('');
  const [isVatPayer, setVatPayer] = useState(false);
  const [tradeIds, setTradeIds] = useState<string[]>([]);
  const [radiusKm, setRadiusKm] = useState<number>(COMPANY_RADIUS.default);
  const [base, setBase] = useState<LatLngValue | null>(null);
  const [baseAddress, setBaseAddress] = useState('');
  const [errors, setErrors] = useState<FormErrors<CompanyField>>({});
  const [saving, setSaving] = useState(false);
  const { scrollRef, onLayout, inputRef, reveal } = useFieldReveal(COMPANY_FIELD_ORDER);
  const e = (f: CompanyField) => (errors[f] ? t(errors[f]!) : null);

  const submit = async () => {
    const { errors: errs, body } = validateCompanyForm({ firstName, lastName, name, legalForm, voen, isVatPayer, tradeIds, radiusKm, base, baseAddress });
    setErrors(errs);
    if (!body) {
      // the invalid field may be far above or below the pinned button: say so and take the manager there
      toast.show(t('onboarding.errors.fixFields'), { kind: 'error' });
      reveal(errs);
      return;
    }
    setSaving(true);
    try {
      const company = await client.call(api.pro.onboardCompany, { body });
      setPreferredMode({ kind: 'company', companyId: company.id });
      setEntryNext(`/kyc?subject=COMPANY&companyId=${encodeURIComponent(company.id)}`);
      void queryClient.invalidateQueries({ queryKey: qk.profile });
      await refreshMe();
    } catch (err) {
      const code = errorCodeOf(err);
      if (code === 'CONFLICT') {
        setErrors({ voen: 'onboarding.errors.voenTaken' });
        reveal({ voen: true });
      }
      toast.show(code === 'CONFLICT' ? t('onboarding.errors.voenTaken') : errorMessage(t, err), { kind: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen
      padded={false}
      testID="company-onboarding-screen"
      footer={<Button title={t('onboarding.continueToKyc')} onPress={() => void submit()} loading={saving} testID="company-submit" />}
    >
      <ScrollView ref={scrollRef} style={styles.flex} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Header title={t('onboarding.companyTitle')} subtitle={t('onboarding.companyFormSubtitle')} onBack={() => router.back()} />
        <AppText variant="h3" style={styles.section}>
          {t('onboarding.managerSection')}
        </AppText>
        <View onLayout={onLayout('firstName')} testID="company-field-firstName">
          <TextField
            ref={inputRef('firstName')}
            label={t('common:fields.firstName')}
            value={firstName}
            onChangeText={setFirstName}
            error={e('firstName')}
            testID="company-first-name"
          />
        </View>
        <View onLayout={onLayout('lastName')} testID="company-field-lastName">
          <TextField
            ref={inputRef('lastName')}
            label={t('common:fields.lastName')}
            value={lastName}
            onChangeText={setLastName}
            error={e('lastName')}
            testID="company-last-name"
          />
        </View>
        <AppText variant="h3" style={styles.section}>
          {t('onboarding.companySection')}
        </AppText>
        <View onLayout={onLayout('name')} testID="company-field-name">
          <TextField ref={inputRef('name')} label={t('common:fields.companyName')} value={name} onChangeText={setName} error={e('name')} testID="company-name" />
        </View>
        <View onLayout={onLayout('legalForm')} testID="company-field-legalForm">
          <AppText variant="bodyStrong" style={styles.label}>
            {t('common:fields.legalForm')}
          </AppText>
          <Segmented
            options={LEGAL_FORMS.map((f) => ({ value: f, label: t(`common:legalForm.${f}`) }))}
            value={legalForm}
            onChange={setLegalForm}
            testID="company-legal-form"
          />
        </View>
        <View style={styles.gap} />
        <View onLayout={onLayout('voen')} testID="company-field-voen">
          <TextField
            ref={inputRef('voen')}
            label={t('common:fields.voen')}
            value={voen}
            onChangeText={(v) => setVoen(sanitizeVoen(v))}
            keyboardType="number-pad"
            maxLength={10}
            error={e('voen')}
            hint={t('onboarding.voenHint')}
            testID="company-voen"
          />
        </View>
        <View style={styles.switchRow}>
          <AppText variant="body" style={styles.flex}>
            {t('onboarding.vatPayer')}
          </AppText>
          <Switch
            value={isVatPayer}
            onValueChange={setVatPayer}
            trackColor={{ true: colors.primary, false: colors.border }}
            thumbColor={colors.surface}
            testID="company-vat"
          />
        </View>
        <View onLayout={onLayout('trades')} testID="company-field-trades">
          <TradePicker value={tradeIds} onChange={setTradeIds} max={COMPANY_MAX_TRADES} error={errors.trades} />
        </View>
        <View onLayout={onLayout('baseAddress')} testID="company-field-baseAddress">
          <TextField
            ref={inputRef('baseAddress')}
            label={t('onboarding.baseAddress')}
            value={baseAddress}
            onChangeText={setBaseAddress}
            error={e('baseAddress')}
            placeholder={t('onboarding.baseAddressPlaceholder')}
            testID="company-base-address"
          />
        </View>
        <View onLayout={onLayout('base')} testID="company-field-base">
          <BasePicker value={base} onChange={setBase} label={t('onboarding.companyBase')} error={errors.base} />
        </View>
        <View onLayout={onLayout('radius')} testID="company-field-radius">
          <RadiusSlider value={radiusKm} onChange={setRadiusKm} min={COMPANY_RADIUS.min} max={COMPANY_RADIUS.max} error={errors.radius} />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // the form scrolls itself (instead of Screen scroll) so a failed submit can scroll to the invalid field
  content: { flexGrow: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  section: { marginTop: spacing.md, marginBottom: spacing.sm },
  label: { marginBottom: spacing.sm },
  gap: { height: spacing.md },
  switchRow: { flexDirection: 'row', alignItems: 'center', marginVertical: spacing.sm },
  flex: { flex: 1 },
});
