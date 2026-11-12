import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText, BottomSheet, Button, TextField, spacing, useT } from '@tezfiks/mobile';

export interface ConfirmSheetProps {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** Shows an optional reason field (sent as `reason`). */
  withReason?: boolean;
  danger?: boolean;
  loading?: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
  testID: string;
}

/** Bottom sheet that asks before an action with consequences (cancel, decline on arrival, no-show, accept a quote). */
export function ConfirmSheet({ visible, title, message, confirmLabel, cancelLabel, withReason, danger = true, loading, onConfirm, onClose, testID }: ConfirmSheetProps) {
  const { t } = useT();
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (visible) setReason('');
  }, [visible]);
  return (
    <BottomSheet visible={visible} onClose={onClose} title={title} testID={testID}>
      <AppText variant="body" style={styles.message} testID={`${testID}-message`}>
        {message}
      </AppText>
      {withReason ? (
        <TextField
          placeholder={t('tracking.reasonPlaceholder')}
          value={reason}
          onChangeText={setReason}
          maxLength={300}
          testID={`${testID}-reason`}
        />
      ) : null}
      <Button variant={danger ? 'danger' : 'primary'} title={confirmLabel} onPress={() => onConfirm(reason.trim())} loading={loading} testID={`${testID}-confirm`} />
      <View style={styles.gap} />
      <Button variant="outline" title={cancelLabel ?? t('common:actions.close')} onPress={onClose} testID={`${testID}-keep`} />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  message: { marginBottom: spacing.md },
  gap: { height: spacing.sm },
});
