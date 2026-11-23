import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { api, bakuDayKey } from '@tezfiks/shared';
import {
  AppText,
  Badge,
  Button,
  Card,
  Header,
  Screen,
  TextField,
  colors,
  newIdempotencyKey,
  spacing,
  useApi,
  useAuth,
  useT,
  useToast,
} from '@tezfiks/mobile';
import { AddressPicker } from '../../components/AddressPicker';
import { CategoryIcon } from '../../components/CategoryIcon';
import { CategoryPickerSheet } from '../../components/CategoryPickerSheet';
import { DayField } from '../../components/DayField';
import { PhotoPicker, isUploading, newPhotoKey, uploadedIds, type PhotoItem } from '../../components/PhotoPicker';
import { Stepper } from '../../components/Stepper';
import { qk, useCategories, useSavedAddresses } from '../../data/queries';
import { useCurrentLocation } from '../../hooks/useCurrentLocation';
import { addressDetails, applyGeoAddress, applyPin, emptyAddressDraft, hasPin, type AddressDraft } from '../../lib/address';
import { findCategory } from '../../lib/categories';
import {
  PROJECT_LIMITS,
  buildCreateProjectBody,
  firstProjectError,
  validateProjectForm,
  workDays,
  type ProjectFormErrors,
  type ProjectFormValues,
} from '../../lib/projects';
import { isRetryableWithSameKey, requestErrorInfo } from '../../lib/requestErrors';

/**
 * Board 02 D "Biznes sifarişi": service (quote-only), site / branch, scope, date range, workers, description, photos →
 * "Qiymət təklifi al" (POST /projects). Providers then quote within the quote window; the customer compares and accepts.
 */
export default function NewProjectRoute() {
  const { t } = useT();
  const client = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ categoryId?: string; description?: string; photoId?: string; photoUrl?: string }>();
  const companyName = useAuth((s) => s.me?.customer?.companyName ?? null);
  const categories = useCategories();
  const saved = useSavedAddresses();
  const [categoryId, setCategoryId] = useState<string | null>(typeof params.categoryId === 'string' ? params.categoryId : null);
  const [title, setTitle] = useState('');
  const [scope, setScope] = useState('');
  const [dateFrom, setDateFrom] = useState<string | null>(null);
  const [dateTo, setDateTo] = useState<string | null>(null);
  const [workers, setWorkers] = useState(1);
  const [description, setDescription] = useState(typeof params.description === 'string' ? params.description : '');
  const [photos, setPhotos] = useState<PhotoItem[]>(() =>
    typeof params.photoId === 'string' && params.photoId
      ? [{ key: newPhotoKey(), uri: typeof params.photoUrl === 'string' ? params.photoUrl : '', fileId: params.photoId, status: 'done' }]
      : [],
  );
  const [address, setAddress] = useState<AddressDraft>(emptyAddressDraft);
  const [saveAddress, setSaveAddress] = useState(false);
  const [saveLabel, setSaveLabel] = useState('');
  const [addressOpen, setAddressOpen] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [errors, setErrors] = useState<ProjectFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const idemKey = useRef<string | null>(null);
  const inFlight = useRef(false);
  const addressTouched = useRef(false);

  const category = findCategory(categories.data, categoryId);
  const quoteCategories = useMemo(() => (categories.data ?? []).filter((c) => c.kind === 'GROUP' || c.flow === 'QUOTE'), [categories.data]);
  const today = bakuDayKey(new Date());
  const days = workDays(dateFrom, dateTo);

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

  const values: ProjectFormValues = { categoryId, title, scope, dateFrom, dateTo, workersNeeded: workers, description, photoFileIds: uploadedIds(photos), address };
  const clear = (k: keyof ProjectFormErrors) => errors[k] && setErrors((e) => ({ ...e, [k]: undefined }));
  const err = (k: keyof ProjectFormErrors) => (errors[k] ? t(errors[k] as string) : null);

  const submit = async () => {
    if (inFlight.current) return;
    if (isUploading(photos)) {
      toast.show(t('photos.waitUpload'));
      return;
    }
    const next = validateProjectForm(values, { category, now: new Date() });
    setErrors(next);
    setFormError(null);
    const first = firstProjectError(next);
    if (first) {
      toast.show(t(first.key), { kind: 'error' });
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    idemKey.current = idemKey.current ?? newIdempotencyKey();
    try {
      const project = await client.call(api.projects.create, { body: buildCreateProjectBody(values), idempotencyKey: idemKey.current });
      idemKey.current = null;
      if (saveAddress && saveLabel.trim() && hasPin(address)) {
        client
          .call(api.customer.createAddress, { body: { ...buildCreateProjectBody(values).address, label: saveLabel.trim(), isSite: true } })
          .then(() => queryClient.invalidateQueries({ queryKey: qk.addresses }))
          .catch(() => undefined);
      }
      queryClient.setQueryData(qk.project(project.id), project);
      void queryClient.invalidateQueries({ queryKey: qk.projectsRoot });
      toast.show(t('project.created'), { kind: 'success' });
      router.replace(`/project/${project.id}` as never);
    } catch (e) {
      if (!isRetryableWithSameKey(e)) idemKey.current = null;
      const info = requestErrorInfo(e);
      setFormError(t(info.messageKey));
      toast.show(t(info.messageKey), { kind: 'error' });
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  return (
    <Screen
      scroll
      edges={['top', 'bottom']}
      testID="project-new-screen"
      footer={
        <View>
          <Button title={t('project.submit')} onPress={() => void submit()} loading={submitting} disabled={isUploading(photos)} testID="project-submit" />
          <AppText variant="caption" color="textMuted" align="center" style={styles.foot}>
            {t('project.footnote')}
          </AppText>
        </View>
      }
    >
      <Header
        title={t('project.newTitle')}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        right={companyName ? <Badge label={companyName} tone="dark" testID="project-company" /> : undefined}
      />

      <AppText variant="small" color="textMuted" style={styles.label}>
        {t('project.service')}
      </AppText>
      <Card onPress={() => setCategoryOpen(true)} style={[styles.block, errors.category ? styles.invalid : null]} testID="project-category">
        <View style={styles.row}>
          <CategoryIcon icon={category?.icon} size={18} />
          <AppText variant="bodyStrong" style={styles.rowText}>
            {category?.name ?? t('project.chooseService')}
          </AppText>
          <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
        </View>
      </Card>
      {err('category') ? <FieldError text={err('category') as string} testID="project-error-category" /> : null}

      <AppText variant="small" color="textMuted" style={styles.label}>
        {t('project.site')}
      </AppText>
      <Card onPress={() => setAddressOpen(true)} style={[styles.block, errors.address ? styles.invalid : null]} testID="project-address">
        <View style={styles.row}>
          <Ionicons name="business-outline" size={18} color={colors.primary} />
          <View style={styles.rowText}>
            <AppText variant="body" numberOfLines={2} testID="project-address-text">
              {hasPin(address) ? address.formatted : t('address.choose')}
            </AppText>
            {addressDetails({ block: address.block || null, entrance: address.entrance || null, floor: address.floor || null, apartment: address.apartment || null }, t) ? (
              <AppText variant="caption" color="textMuted">
                {addressDetails({ block: address.block || null, entrance: address.entrance || null, floor: address.floor || null, apartment: address.apartment || null }, t)}
              </AppText>
            ) : null}
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </View>
      </Card>
      {err('address') ? <FieldError text={err('address') as string} testID="project-error-address" /> : null}

      <TextField
        label={t('project.scope')}
        placeholder={t('project.scopePlaceholder')}
        value={scope}
        onChangeText={(v) => {
          setScope(v);
          clear('scope');
        }}
        maxLength={PROJECT_LIMITS.scope}
        error={err('scope')}
        testID="project-scope"
      />

      <AppText variant="small" color="textMuted" style={styles.label}>
        {t('project.dates')}
      </AppText>
      <View style={styles.dates}>
        <DayField
          label={t('project.dateFrom')}
          value={dateFrom}
          placeholder={t('project.pickDate')}
          minimumDay={today}
          onChange={(d) => {
            setDateFrom(d);
            if (dateTo && dateTo < d) setDateTo(d);
            clear('dateFrom');
          }}
          error={err('dateFrom')}
          testID="project-date-from"
        />
        <View style={styles.hgap} />
        <DayField
          label={t('project.dateTo')}
          value={dateTo}
          placeholder={t('project.pickDate')}
          minimumDay={dateFrom ?? today}
          onChange={(d) => {
            setDateTo(d);
            clear('dateTo');
          }}
          error={err('dateTo')}
          testID="project-date-to"
        />
      </View>
      {days > 0 ? (
        <AppText variant="caption" color="textMuted" style={styles.label} testID="project-days">
          {t('project.daysCount', { days })}
        </AppText>
      ) : null}

      <AppText variant="small" color="textMuted" style={[styles.label, styles.section]}>
        {t('project.workers')}
      </AppText>
      <Stepper
        value={workers}
        min={1}
        max={PROJECT_LIMITS.workersMax}
        onChange={setWorkers}
        label={t('common:units.workers', { count: workers })}
        decrementLabel={t('request.slotsLess')}
        incrementLabel={t('request.slotsMore')}
        testID="project-workers"
      />

      <View style={styles.section} />
      <TextField label={t('project.titleLabel')} value={title} onChangeText={setTitle} maxLength={PROJECT_LIMITS.title} error={err('title')} testID="project-title" />
      <TextField
        label={t('common:fields.description')}
        placeholder={t('project.descriptionPlaceholder')}
        value={description}
        onChangeText={(v) => {
          setDescription(v);
          clear('description');
        }}
        multiline
        maxLength={PROJECT_LIMITS.description}
        error={err('description')}
        testID="project-description"
      />
      <AppText variant="bodyStrong" style={styles.label}>
        {t('photos.title')}
      </AppText>
      <PhotoPicker items={photos} onChange={setPhotos} max={PROJECT_LIMITS.photos} />

      <Card dark style={styles.section} testID="project-corporate">
        <AppText variant="h3" color="mint">
          {t('project.corporateTitle')}
        </AppText>
        <AppText variant="small" color="textInverseMuted">
          {t('project.corporateText')}
        </AppText>
      </Card>
      {formError ? (
        <AppText variant="small" color="danger" style={styles.section} testID="project-form-error">
          {formError}
        </AppText>
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
          clear('address');
          setAddressOpen(false);
        }}
      />
      <CategoryPickerSheet
        visible={categoryOpen}
        categories={quoteCategories}
        initialVertical={category?.vertical ?? 'HOME'}
        onClose={() => setCategoryOpen(false)}
        onSelect={(c) => {
          setCategoryId(c.id);
          clear('category');
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
  block: { marginBottom: spacing.sm },
  invalid: { borderColor: colors.danger },
  row: { flexDirection: 'row', alignItems: 'center' },
  rowText: { flex: 1, marginHorizontal: spacing.md },
  label: { marginBottom: spacing.xs },
  section: { marginTop: spacing.md },
  dates: { flexDirection: 'row', marginBottom: spacing.sm },
  hgap: { width: spacing.sm },
  fieldError: { marginBottom: spacing.sm },
  foot: { marginTop: spacing.sm },
});
