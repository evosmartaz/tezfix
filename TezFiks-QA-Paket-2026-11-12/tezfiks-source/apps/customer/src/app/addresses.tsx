import React, { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Switch, View } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { api, type SavedAddress } from '@tezfiks/shared';
import {
  AppText,
  BottomSheet,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Header,
  LoadingState,
  Screen,
  TextField,
  colors,
  errorMessage,
  spacing,
  useApi,
  useAuth,
  useT,
  useToast,
} from '@tezfiks/mobile';
import { AddressPicker } from '../components/AddressPicker';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { qk, useSavedAddresses } from '../data/queries';
import { useCurrentLocation } from '../hooks/useCurrentLocation';
import { addressDetails, addressInputFromDraft, applyPin, emptyAddressDraft, type AddressDraft } from '../lib/address';
import { SAVE_LABEL_MAX } from '../lib/requestPayload';

/** Address book: saved addresses (and company sites "Obyekt / filial"), add with the map picker, rename, delete. */
export default function AddressesRoute() {
  const { t } = useT();
  const client = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const isCompany = useAuth((s) => s.me?.customer?.type === 'COMPANY');
  const list = useSavedAddresses();
  const location = useCurrentLocation();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<SavedAddress | null>(null);
  const [label, setLabel] = useState('');
  const [isSite, setIsSite] = useState(false);
  const [deleting, setDeleting] = useState<SavedAddress | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: qk.addresses });
  const startDraft = (): AddressDraft => {
    const c = location.coords;
    return c ? applyPin(emptyAddressDraft(), c.lat, c.lng) : emptyAddressDraft();
  };

  const create = async (draft: AddressDraft, saveLabel: string) => {
    setBusy(true);
    try {
      await client.call(api.customer.createAddress, { body: { ...addressInputFromDraft(draft), label: saveLabel.trim() || null, ...(isCompany ? { isSite: true } : {}) } });
      toast.show(t('addresses.saved'), { kind: 'success' });
      setAdding(false);
      refresh();
    } catch (err) {
      toast.show(errorMessage(t, err), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const update = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      await client.call(api.customer.updateAddress, { params: { id: editing.id }, body: { label: label.trim() || null, isSite } });
      toast.show(t('addresses.saved'), { kind: 'success' });
      setEditing(null);
      refresh();
    } catch (err) {
      toast.show(errorMessage(t, err), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await client.call(api.customer.deleteAddress, { params: { id: deleting.id } });
      toast.show(t('addresses.deleted'), { kind: 'success' });
      setDeleting(null);
      refresh();
    } catch (err) {
      toast.show(errorMessage(t, err), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={['top', 'bottom']} testID="addresses-screen" footer={<Button title={t('addresses.add')} onPress={() => setAdding(true)} testID="addresses-add" />}>
      <Header title={t('addresses.title')} onBack={() => (router.canGoBack() ? router.back() : router.replace('/profile'))} />
      {list.isPending ? (
        <LoadingState />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : (
        <FlatList
          data={list.data}
          keyExtractor={(a) => a.id}
          renderItem={({ item }) => (
            <Card style={styles.card} testID={`address-${item.id}`}>
              <View style={styles.row}>
                <Ionicons name={item.isSite ? 'business-outline' : 'location-outline'} size={20} color={colors.primary} />
                <View style={styles.text}>
                  <AppText variant="bodyStrong">{item.label ?? item.formatted}</AppText>
                  {item.label ? (
                    <AppText variant="small" color="textMuted">
                      {item.formatted}
                    </AppText>
                  ) : null}
                  {addressDetails(item, t) ? (
                    <AppText variant="caption" color="textMuted">
                      {addressDetails(item, t)}
                    </AppText>
                  ) : null}
                  {item.isSite ? (
                    <AppText variant="caption" color="primaryDark">
                      {t('addresses.site')}
                    </AppText>
                  ) : null}
                </View>
                <Pressable
                  onPress={() => {
                    setEditing(item);
                    setLabel(item.label ?? '');
                    setIsSite(item.isSite);
                  }}
                  hitSlop={8}
                  accessibilityLabel={t('addresses.edit')}
                  testID={`address-edit-${item.id}`}
                >
                  <Ionicons name="create-outline" size={20} color={colors.textMuted} />
                </Pressable>
                <Pressable onPress={() => setDeleting(item)} hitSlop={8} style={styles.icon} accessibilityLabel={t('addresses.delete')} testID={`address-delete-${item.id}`}>
                  <Ionicons name="trash-outline" size={20} color={colors.danger} />
                </Pressable>
              </View>
            </Card>
          )}
          ListEmptyComponent={<EmptyState icon="location-outline" title={t('addresses.empty')} testID="addresses-empty" />}
          contentContainerStyle={styles.list}
        />
      )}

      <AddressPicker
        visible={adding}
        value={adding ? startDraft() : emptyAddressDraft()}
        saved={[]}
        saveAddress
        saveLabel=""
        onClose={() => setAdding(false)}
        onConfirm={(draft, s) => void create(draft, s.saveLabel)}
      />

      <BottomSheet visible={!!editing} onClose={() => setEditing(null)} title={t('addresses.edit')} testID="address-edit-sheet">
        <TextField label={t('address.label')} placeholder={t('address.labelPlaceholder')} value={label} onChangeText={setLabel} maxLength={SAVE_LABEL_MAX} testID="address-edit-label" />
        {isCompany ? (
          <View style={styles.switchRow}>
            <AppText variant="body" style={styles.text}>
              {t('addresses.siteHint')}
            </AppText>
            <Switch value={isSite} onValueChange={setIsSite} testID="address-edit-site" />
          </View>
        ) : null}
        <Button title={t('common:actions.save')} onPress={() => void update()} loading={busy} testID="address-edit-save" />
      </BottomSheet>

      <ConfirmSheet
        visible={!!deleting}
        title={t('addresses.deleteTitle')}
        message={deleting ? deleting.label ?? deleting.formatted : ''}
        confirmLabel={t('common:actions.delete')}
        loading={busy}
        onConfirm={() => void remove()}
        onClose={() => setDeleting(null)}
        testID="address-delete-sheet"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: spacing.xl, flexGrow: 1 },
  card: { marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center' },
  text: { flex: 1, marginHorizontal: spacing.md },
  icon: { marginLeft: spacing.md },
  switchRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
});
