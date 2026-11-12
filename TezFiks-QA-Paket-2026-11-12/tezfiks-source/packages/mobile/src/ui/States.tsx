import React, { type ComponentProps, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '../theme/tokens';
import { errorMessage, isNetworkError } from '../errors';
import { useT } from '../i18n';
import { AppText } from './Text';
import { Button } from './Button';

type IconName = ComponentProps<typeof Ionicons>['name'];

export interface EmptyStateProps {
  title?: string;
  message?: string;
  icon?: IconName;
  action?: ReactNode;
  testID?: string;
}

export function EmptyState({ title, message, icon = 'file-tray-outline', action, testID = 'empty-state' }: EmptyStateProps) {
  const { t } = useT();
  return (
    <View style={styles.wrap} testID={testID}>
      <Ionicons name={icon} size={44} color={colors.borderStrong} />
      <AppText variant="h3" align="center" style={styles.title}>
        {title ?? t('common:states.empty')}
      </AppText>
      {message ? (
        <AppText variant="small" color="textMuted" align="center">
          {message}
        </AppText>
      ) : null}
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

export interface ErrorStateProps {
  /** The thrown error; its code is mapped to common.errors.<CODE>. */
  error?: unknown;
  message?: string;
  onRetry?: () => void;
  retrying?: boolean;
  testID?: string;
}

/** Error with a retry button (network failures show the offline icon). */
export function ErrorState({ error, message, onRetry, retrying, testID = 'error-state' }: ErrorStateProps) {
  const { t } = useT();
  const text = message ?? (error ? errorMessage(t, error) : t('common:states.error'));
  return (
    <View style={styles.wrap} testID={testID}>
      <Ionicons name={isNetworkError(error) ? 'cloud-offline-outline' : 'alert-circle-outline'} size={44} color={colors.danger} />
      <AppText variant="h3" align="center" style={styles.title}>
        {text}
      </AppText>
      {onRetry ? (
        <View style={styles.action}>
          <Button title={t('common:actions.retry')} onPress={onRetry} loading={retrying} fullWidth={false} testID={`${testID}-retry`} />
        </View>
      ) : null}
    </View>
  );
}

export function LoadingState({ testID = 'loading-state', dark }: { testID?: string; dark?: boolean }) {
  return (
    <View style={[styles.wrap, dark ? { backgroundColor: colors.dark } : null]} testID={testID}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  title: { marginTop: spacing.md, marginBottom: spacing.xs },
  action: { marginTop: spacing.lg },
});
