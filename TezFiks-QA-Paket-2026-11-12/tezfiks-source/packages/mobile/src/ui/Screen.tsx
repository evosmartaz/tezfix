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
  /**
   * Big h1 title under the back arrow (auth and onboarding steps: "Təsdiq kodu", "Hesab tipini seçin"). By default the
   * title sits next to the back arrow ("← Sifariş — Santexnik").
   */
  large?: boolean;
}

/** Screen header: 48 dp back arrow (UX-C09) and the title inline, or large below it. */
export function Header({ title, subtitle, onBack, backLabel, right, dark, large }: HeaderProps) {
  const { t } = useT();
  const fg = dark ? 'textInverse' : 'text';
  const inlineTitle = title && !large;
  return (
    <View style={styles.header}>
      <View style={styles.headerRow}>
        {onBack ? (
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel={backLabel ?? t('common:actions.back')}
            hitSlop={8}
            style={styles.back}
            testID="header-back"
          >
            <Ionicons name="arrow-back" size={24} color={dark ? colors.textInverse : colors.text} />
          </Pressable>
        ) : null}
        {inlineTitle ? (
          <AppText variant="h2" color={fg} accessibilityRole="header" numberOfLines={2} style={styles.inlineTitle}>
            {title}
          </AppText>
        ) : (
          <View style={styles.flex} />
        )}
        {right}
      </View>
      {title && large ? (
        <AppText variant="h1" color={fg} accessibilityRole="header" style={styles.largeTitle}>
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
  headerRow: { flexDirection: 'row', alignItems: 'center', minHeight: 48 },
  back: { width: 48, height: 48, marginLeft: -spacing.md, alignItems: 'center', justifyContent: 'center' },
  inlineTitle: { flex: 1, marginRight: spacing.sm },
  largeTitle: { marginTop: spacing.md },
  subtitle: { marginTop: spacing.xs },
});
