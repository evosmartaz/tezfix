import React, { type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radii, shadows, spacing } from '../theme/tokens';
import { AppText } from './Text';
import { ModalToastHost } from './Toast';

export interface BottomSheetProps {
  visible: boolean;
  onClose?: () => void;
  title?: string;
  children: ReactNode;
  /** Prevents closing by tapping the backdrop (offer modal: the user must accept or decline). */
  dismissable?: boolean;
  testID?: string;
}

/**
 * Bottom sheet style modal (board 03 incoming offer, pickers, confirmations). The modal covers the root toast host, so
 * the sheet draws the toasts itself while it is open (an action that fails inside the sheet shows its error above it).
 */
export function BottomSheet({ visible, onClose, title, children, dismissable = true, testID = 'bottom-sheet' }: BottomSheetProps) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={dismissable ? onClose : undefined} statusBarTranslucent>
      <View style={styles.backdrop} testID={testID}>
        <Pressable style={StyleSheet.absoluteFill} onPress={dismissable ? onClose : undefined} accessible={false} testID={`${testID}-backdrop`} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={styles.handle} />
          {title ? (
            <AppText variant="h2" style={styles.title}>
              {title}
            </AppText>
          ) : null}
          {children}
        </View>
        {/* Unmounted as soon as the sheet starts closing, so a success toast goes straight to the root host. */}
        {visible ? <ModalToastHost /> : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlay },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    ...shadows.sheet,
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: spacing.md },
  title: { marginBottom: spacing.md },
});
