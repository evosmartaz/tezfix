import React, { type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '../theme/tokens';
import { AppText } from './Text';
import { useT } from '../i18n';

export interface ScreenProps {
  children: ReactNode;
  /** Dark hero background (board 02 A1, board 03 offer). */
  dark?: boolean;
  scroll?: boolean;
  padded?: boolean;
  edges?: Edge[];
  /** Pinned below the content (primary action). */
  footer?: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Screen({
  children,
  dark,
  scroll,
  padded = true,
  edges = ['top', 'bottom'],
  footer,
  refreshing,
  onRefresh,
  style,
  contentStyle,
  testID,
}: ScreenProps) {
  const bg = dark ? colors.dark : colors.background;
  const inner = [padded && styles.padded, contentStyle];
  return (
    <SafeAreaView edges={edges} style={[styles.root, { backgroundColor: bg }, style]} testID={testID}>
      {/* Status-bar icons that contrast with this screen's background (the last mounted StatusBar wins). */}
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
      {/* 'padding' on both platforms: Expo SDK 58 apps are edge-to-edge on Android, where the window no longer resizes
          for the keyboard (softwareKeyboardLayoutMode 'resize' has no effect), so the screen has to make room itself. */}
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        {scroll ? (
          <ScrollView
            style={styles.flex}
            contentContainerStyle={[styles.grow, inner]}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.primary} /> : undefined
            }
          >
            {children}
          </ScrollView>
        ) : (
          <View style={[styles.flex, inner]}>{children}</View>
        )}
        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export interface HeaderProps {
  title?: string;
  subtitle?: string;
  onBack?: () => void;
  /** Accessibility label of the back arrow (default: common actions.back). */
  backLabel?: string;
  right?: ReactNode;
  dark?: boolean;
}

/** Screen header: back arrow, bold title (board 02 A2 "Təsdiq kodu"). */
export function Header({ title, subtitle, onBack, backLabel, right, dark }: HeaderProps) {
  const { t } = useT();
  const fg = dark ? 'textInverse' : 'text';
  return (
    <View style={styles.header}>
      <View style={styles.headerRow}>
        {onBack ? (
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel={backLabel ?? t('common:actions.back')}
            hitSlop={12}
            style={styles.back}
            testID="header-back"
          >
            <Ionicons name="arrow-back" size={22} color={dark ? colors.textInverse : colors.text} />
          </Pressable>
        ) : null}
        <View style={styles.flex} />
        {right}
      </View>
      {title ? (
        <AppText variant="h1" color={fg} accessibilityRole="header">
          {title}
        </AppText>
      ) : null}
      {subtitle ? (
        <AppText variant="small" color={dark ? 'textInverseMuted' : 'textMuted'} style={styles.subtitle}>
          {subtitle}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  grow: { flexGrow: 1 },
  padded: { paddingHorizontal: spacing.xl, paddingTop: spacing.md },
  footer: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xl, paddingTop: spacing.md, backgroundColor: colors.surface },
  header: { marginBottom: spacing.lg },
  headerRow: { flexDirection: 'row', alignItems: 'center', minHeight: 48, marginBottom: spacing.sm },
  back: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  subtitle: { marginTop: spacing.xs },
});
