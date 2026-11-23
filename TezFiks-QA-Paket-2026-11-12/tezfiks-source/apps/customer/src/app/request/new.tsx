import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { DEFAULT_SETTINGS, api, formatMoney, type ProviderPreference, type RequestTiming } from '@tezfiks/shared';
import {
  AppText,
  Banner,
  Button,
  Card,
  Header,
  Screen,
  Segmented,
  TextField,
  colors,
  newIdempotencyKey,
  radii,
  spacing,
  useApi,
  useAuth,
  useT,
  useToast,
} from '@tezfiks/mobile';
import { AddressPicker } from '../../components/AddressPicker';
import { CategoryIcon } from '../../components/CategoryIcon';
import { CategoryPickerSheet } from '../../components/CategoryPickerSheet';
import { PhotoPicker, isUploading, newPhotoKey, uploadedIds, type PhotoItem } from '../../components/PhotoPicker';
import { ScheduledPicker } from '../../components/ScheduledPicker';
import { Stepper } from '../../components/Stepper';
import { qk, useCategories, useCustomerAccount, usePublicConfig, useRequest, useSavedAddresses, useTimingConfig } from '../../data/queries';
import { useCurrentLocation } from '../../hooks/useCurrentLocation';
import { addressDetails, applyGeoAddress, applyPin, emptyAddressDraft, hasPin, savedAddressToDraft, type AddressDraft } from '../../lib/address';
import { findCategory } from '../../lib/categories';
import { requestHref } from '../../lib/orders';
import { walletTopUpHref } from '../../lib/payments';
import { requestErrorInfo, isRetryableWithSameKey } from '../../lib/requestErrors';
import {
  buildCreateRequestBody,
  canChooseProvider,
  firstError,
  validateRequestForm,
  type RequestFormErrors,
  type RequestFormValues,
} from '../../lib/requestPayload';
import { availableTimings, clampSlots, coerceTiming, defaultScheduledAt, emergencyFeeFor, emergencyShortfall, scheduleBounds } from '../../lib/timing';

type Params = { categoryId?: string; photoId?: string; photoUrl?: string; repeatId?: string; description?: string };

/** Board 02 B3 "Sifariş yarat": address, description, photos, İndi / Planla / Təcili, handymen count, preference, "Usta çağır". */
export default function CreateRequestRoute() {
  const { t, locale } = useT();
  const client = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<Params>();
  const customerType = useAuth((s) => s.me?.customer?.type ?? null);
  const config = useTimingConfig();
  const publicConfig = usePublicConfig();
  const categories = useCategories();
  const account = useCustomerAccount();
  const saved = useSavedAddresses();
  const repeat = useRequest(typeof params.repeatId === 'string' ? params.repeatId : undefined);

  const [categoryId, setCategoryId] = useState<string | null>(typeof params.categoryId === 'string' ? params.categoryId : null);
  const [description, setDescription] = useState(typeof params.description === 'string' ? params.description : '');
  const [photos, setPhotos] = useState<PhotoItem[]>(() =>
    typeof params.photoId === 'string' && params.photoId
      ? [{ key: newPhotoKey(), uri: typeof params.photoUrl === 'string' ? params.photoUrl : '', fileId: params.photoId, status: 'done' }]
      : [],
  );
  const [timing, setTiming] = useState<RequestTiming>('NOW');
  const [scheduledAt, setScheduledAt] = useState<Date | null>(null);
  const [slots, setSlots] = useState(1);
  const [preference, setPreference] = useState<ProviderPreference>('ANY');
  const [address, setAddress] = useState<AddressDraft>(emptyAddressDraft);
  const [saveAddress, setSaveAddress] = useState(false);
  const [saveLabel, setSaveLabel] = useState('');
  const [addressOpen, setAddressOpen] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [errors, setErrors] = useState<RequestFormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<{ message: string; action: string | null } | null>(null);
  const idemKey = useRef<string | null>(null);
  /** Synchronous double-tap guard: a second tap before the re-render must not send a second call with the same key. */
  const inFlight = useRef(false);
  const addressTouched = useRef(false);
  const prefilled = useRef(false);

  const category = findCategory(categories.data, categoryId);
  const walletAvailable = account.data ? account.data.wallet.available : null;
  const timings = availableTimings(category);
  const emergencyFee = emergencyFeeFor(timing, slots, config);
  const shortfall = emergencyShortfall(walletAvailable, emergencyFee);
  const bounds = useMemo(() => scheduleBounds(new Date(), config), [config, timing]);

  // Pin at the current position (reverse geocoded) until the customer picks an address.
  const location = useCurrentLocation();
  useEffect(() => {
    const c = location.coords;
    if (!c || addressTouched.current || hasPin(address)) return;
    setAddress((d) => applyPin(d, c.lat, c.lng));
    client
      .call(api.geo.reverse, { query: { lat: c.lat, lng: c.lng } })
      .then((geo) => {
        if (!addressTouched.current) setAddress((d) => applyGeoAddress(d, geo));
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.coords]);

  // "Yenidən sifariş ver" after an expired search: same service, text, address and handymen count.
  useEffect(() => {
    const r = repeat.data;
    if (!r || prefilled.current) return;
    prefilled.current = true;
    addressTouched.current = true;
    setCategoryId(r.category.id);
    setDescription(r.description);
    setAddress(savedAddressToDraft(r.address));
    setSlots(r.slotsRequested);
    setPreference(r.providerPreference);
  }, [repeat.data]);

  // A category change can make the current timing unavailable (emergency).
  useEffect(() => {
    setTiming((tm) => coerceTiming(tm, category));
  }, [category]);

  useEffect(() => {
    setSlots((s) => clampSlots(s, config.maxSlots));
  }, [config.maxSlots]);

  const changeTiming = (tm: RequestTiming) => {
    setTiming(tm);
    setErrors((e) => ({ ...e, timing: undefined, scheduledAt: undefined }));
    if (tm === 'SCHEDULED' && !scheduledAt) setScheduledAt(defaultScheduledAt(new Date(), config));
  };

  const values: RequestFormValues = {
    categoryId,
    description,
    photoFileIds: uploadedIds(photos),
    timing,
    scheduledAt,
    slots,
    providerPreference: preference,
    address,
    saveAddress,
    saveAddressLabel: saveLabel,
  };

  /** Top-up sized to what is missing: the emergency shortfall, or the debt. */
  const openTopUp = () => {
    const debt = account.data && account.data.wallet.posted < 0 ? -account.data.wallet.posted : 0;
    router.push(walletTopUpHref(shortfall > 0 ? shortfall : debt || null));
  };
  /** Quote-only services are ordered through the business request (board 02 D). */
  const openBusiness = () =>
    router.replace({ pathname: '/project/new', params: { ...(categoryId ? { categoryId } : {}), ...(description.trim() ? { description: description.trim() } : {}) } });

  const submit = async () => {
    if (inFlight.current) return;
    if (isUploading(photos)) {
      toast.show(t('photos.waitUpload'));
      return;
    }
    const ctx = { category, customerType, config, now: new Date(), walletAvailable };
    const next = validateRequestForm(values, ctx);
    setErrors(next);
    setFormError(null);
    const first = firstError(next);
    if (first) {
      toast.show(t(first.key), { kind: 'error' });
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    idemKey.current = idemKey.current ?? newIdempotencyKey();
    try {
      const detail = await client.call(api.requests.create, { body: buildCreateRequestBody(values, { customerType }), idempotencyKey: idemKey.current });
      idemKey.current = null;
      queryClient.setQueryData(qk.request(detail.id), detail);
      void queryClient.invalidateQueries({ queryKey: qk.requestsRoot });
      void queryClient.invalidateQueries({ queryKey: qk.account });
      if (values.saveAddress) void queryClient.invalidateQueries({ queryKey: qk.addresses });
      router.replace(requestHref(detail) as never);
    } catch (err) {
      if (!isRetryableWithSameKey(err)) idemKey.current = null;
      const info = requestErrorInfo(err);
      const message = t(info.messageKey);
      if (info.field) setErrors((e) => ({ ...e, [info.field as string]: info.messageKey }));
      setFormError({ message, action: info.action });
      toast.show(message, {
        kind: 'error',
        ...(info.action === 'topUp' ? { actionLabel: t('common:actions.topUp'), onAction: openTopUp } : {}),
        ...(info.action === 'business' ? { actionLabel: t('request.business'), onAction: openBusiness } : {}),
      });
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  const err = (k: keyof RequestFormErrors) => (errors[k] ? t(errors[k] as string) : null);
  const details = addressDetails(
    { block: address.block || null, entrance: address.entrance || null, floor: address.floor || null, apartment: address.apartment || null },
    t,
  );
  const isQuote = category?.flow === 'QUOTE';

  return (
    <Screen
      scroll
      edges={['top', 'bottom']}
      testID="create-request-screen"
      footer={
        <View>
          <AppText variant="caption" color="textMuted" align="center" style={styles.footNote}>
            {t('request.priceNote')}
          </AppText>
          {/* UX-C05: the cancel rule is shown before the customer calls a handyman. */}
          <View style={styles.cancelRule} testID="request-cancel-rule">
            <Ionicons name="time-outline" size={16} color={colors.accentText} />
            <AppText variant="small" color="accentText" style={styles.cancelRuleText}>
              {t('request.cancelRule', {
                min: Math.round((publicConfig.data?.freeCancelSec ?? DEFAULT_SETTINGS.freeCancelSec) / 60),
                amount: formatMoney(publicConfig.data?.cancelPenalty ?? DEFAULT_SETTINGS.cancelPenalty, locale, { compact: true }),
              })}
            </AppText>
          </View>
          <Button
            title={t('request.submit')}
            onPress={() => void submit()}
            loading={submitting}
            disabled={isQuote || isUploading(photos)}
            testID="request-submit"
          />
        </View>
      }
    >
      <Header
        title={t('request.title')}
        subtitle={category?.name}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      />

      {/* Service */}
      <Card onPress={() => setCategoryOpen(true)} style={[styles.block, errors.category ? styles.invalid : null]} testID="request-category">
        <View style={styles.row}>
          <CategoryIcon icon={category?.icon} size={18} />
          <View style={styles.rowText}>
            <AppText variant="caption" color="textMuted">
              {t('request.service')}
            </AppText>
            <AppText variant="bodyStrong">{category?.name ?? t('request.chooseService')}</AppText>
          </View>
          <AppText variant="small" color="primary">
            {t('request.change')}
          </AppText>
        </View>
      </Card>
      {err('category') ? <FieldError text={err('category') as string} testID="error-category" /> : null}
      {isQuote ? (
        <View testID="request-quote-only">
          <Banner tone="info" message={t('request.quoteOnly')} />
          <Button variant="secondary" title={t('request.business')} onPress={openBusiness} testID="request-business" />
          <View style={styles.gap} />
        </View>
      ) : null}

      {/* Address */}
      <AppText variant="bodyStrong" style={styles.label}>
        {t('common:fields.address')}
      </AppText>
      <Card
        onPress={() => setAddressOpen(true)}
        style={[styles.block, errors.address ? styles.invalid : null]}
        testID="request-address"
        accessibilityLabel={t('common:fields.address')}
      >
        <View style={styles.row}>
          <Ionicons name="location-outline" size={20} color={colors.primary} />
          <View style={styles.rowText}>
            <AppText variant="body" numberOfLines={2} testID="request-address-text">
              {hasPin(address) ? address.formatted : location.loading ? t('address.locating') : t('address.choose')}
            </AppText>
            {details ? (
              <AppText variant="caption" color="textMuted">
                {details}
              </AppText>
            ) : null}
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </View>
      </Card>
      {err('address') ? <FieldError text={err('address') as string} testID="error-address" /> : null}
      {err('saveAddressLabel') ? <FieldError text={err('saveAddressLabel') as string} testID="error-saveAddressLabel" /> : null}

      {/* Description */}
      <TextField
        label={t('common:fields.description')}
        placeholder={t('request.descriptionPlaceholder')}
        value={description}
        onChangeText={(v) => {
          setDescription(v);
          if (errors.description) setErrors((e) => ({ ...e, description: undefined }));
        }}
        multiline
        maxLength={2000}
        error={err('description')}
        testID="request-description"
      />

      {/* Photos */}
      <AppText variant="bodyStrong" style={styles.label}>
        {t('photos.title')}
      </AppText>
      <PhotoPicker items={photos} onChange={setPhotos} max={config.maxPhotos} />
      {err('photos') ? <FieldError text={err('photos') as string} testID="error-photos" /> : null}

      {/* Timing */}
      <AppText variant="bodyStrong" style={[styles.label, styles.section]}>
        {t('request.when')}
      </AppText>
      <Segmented
        variant="green"
        options={timings.map((v) => ({ value: v, label: t(`common:timing.${v}`) }))}
        value={timing}
        onChange={changeTiming}
        testID="request-timing"
      />
      <View style={styles.gap} />
      {timing === 'SCHEDULED' && scheduledAt ? (
        <ScheduledPicker
          value={scheduledAt}
          minimumDate={bounds.min}
          maximumDate={bounds.max}
          onChange={(d) => {
            setScheduledAt(d);
            setErrors((e) => ({ ...e, scheduledAt: undefined }));
          }}
          error={err('scheduledAt')}
        />
      ) : null}
      {timing === 'EMERGENCY' ? (
        <View testID="request-emergency">
          <Banner
            tone="warning"
            title={t('request.emergencyTitle')}
            message={t('request.emergencyFee', {
              perSlot: formatMoney(config.emergencyFeePerSlot, locale, { compact: true }),
              total: formatMoney(emergencyFee, locale, { compact: true }),
            })}
          />
          {walletAvailable !== null ? (
            <AppText variant="small" color={shortfall > 0 ? 'danger' : 'textMuted'} testID="request-wallet">
              {t('request.walletAvailable', { amount: formatMoney(walletAvailable, locale) })}
            </AppText>
          ) : null}
          {shortfall > 0 ? (
            <View style={styles.topUp} testID="request-emergency-shortfall">
              <AppText variant="small" color="danger" style={styles.flex}>
                {t('request.emergencyShortfall', { amount: formatMoney(shortfall, locale) })}
              </AppText>
              <Button size="sm" variant="accent" fullWidth={false} title={t('common:actions.topUp')} onPress={openTopUp} testID="request-topup" />
            </View>
          ) : null}
        </View>
      ) : null}
      {err('timing') ? <FieldError text={err('timing') as string} testID="error-timing" /> : null}

      {/* Handymen */}
      <AppText variant="bodyStrong" style={[styles.label, styles.section]}>
        {t('request.slots')}
      </AppText>
      <Stepper
        value={slots}
        min={1}
        max={config.maxSlots}
        onChange={setSlots}
        label={t('common:units.workers', { count: slots })}
        decrementLabel={t('request.slotsLess')}
        incrementLabel={t('request.slotsMore')}
        testID="request-slots"
      />
      {err('slots') ? <FieldError text={err('slots') as string} testID="error-slots" /> : null}

      {/* Provider preference (company accounts only) */}
      {canChooseProvider(customerType) ? (
        <View testID="request-preference">
          <AppText variant="bodyStrong" style={[styles.label, styles.section]}>
            {t('request.preference')}
          </AppText>
          <Segmented
            options={(['ANY', 'INDIVIDUAL', 'COMPANY'] as const).map((v) => ({ value: v, label: t(`common:providerPreference.${v}`) }))}
            value={preference}
            onChange={setPreference}
            testID="request-preference-switch"
          />
        </View>
      ) : null}

      {formError ? (
        <View style={styles.formError} testID="request-form-error">
          <AppText variant="small" color="danger">
            {formError.message}
          </AppText>
          {formError.action === 'business' ? (
            <Button size="sm" variant="outline" fullWidth={false} title={t('request.business')} onPress={openBusiness} testID="request-error-business" />
          ) : null}
          {formError.action === 'topUp' ? (
            <Button size="sm" variant="outline" fullWidth={false} title={t('common:actions.topUp')} onPress={openTopUp} testID="request-error-topup" />
          ) : null}
        </View>
      ) : null}

      <AddressPicker
        visible={addressOpen}
        value={address}
        saved={saved.data ?? []}
        saveAddress={saveAddress}
        saveLabel={saveLabel}
        onClose={() => setAddressOpen(false)}
        onConfirm={(draft, s) => {
          addressTouched.current = true;
          setAddress(draft);
          setSaveAddress(s.saveAddress);
          setSaveLabel(s.saveLabel);
          setErrors((e) => ({ ...e, address: undefined }));
          setAddressOpen(false);
        }}
      />
      <CategoryPickerSheet
        visible={categoryOpen}
        categories={categories.data ?? []}
        initialVertical={category?.vertical ?? 'HOME'}
        onClose={() => setCategoryOpen(false)}
        onSelect={(c) => {
          setCategoryId(c.id);
          setErrors((e) => ({ ...e, category: undefined }));
          setCategoryOpen(false);
        }}
      />
    </Screen>
  );
}

function FieldError({ text, testID }: { text: string; testID?: string }) {
  return (
    <AppText variant="caption" color="danger" style={styles.fieldError} testID={testID}>
      {text}
    </AppText>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  block: { marginBottom: spacing.sm },
  invalid: { borderColor: colors.danger },
  row: { flexDirection: 'row', alignItems: 'center' },
  rowText: { flex: 1, marginHorizontal: spacing.md },
  label: { marginBottom: spacing.xs },
  section: { marginTop: spacing.md },
  gap: { height: spacing.sm },
  fieldError: { marginBottom: spacing.sm },
  topUp: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.dangerSoft,
  },
  formError: { marginTop: spacing.md, gap: spacing.sm },
  footNote: { marginBottom: spacing.sm },
  cancelRule: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
  cancelRuleText: { marginLeft: spacing.xs, flexShrink: 1 },
});

