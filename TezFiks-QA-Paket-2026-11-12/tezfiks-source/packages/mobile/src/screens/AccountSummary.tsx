import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { formatPhone } from '@tezfiks/shared';
import { useT } from '../i18n';
import { useAuth, useRuntime } from '../runtime';
import { spacing } from '../theme/tokens';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { LanguagePicker } from '../ui/LanguagePicker';
import { AppText } from '../ui/Text';

/** Own profile header + language + logout (skeleton profile tab; feature lanes add their sections around it). */
export function AccountSummary({ testID = 'account-summary' }: { testID?: string }) {
  const { t } = useT();
  const runtime = useRuntime();
  const me = useAuth((s) => s.me);
  const [busy, setBusy] = useState(false);
  return (
    <View testID={testID}>
      <Card style={styles.card}>
        <View style={styles.row}>
          <Avatar uri={me?.photo?.url} firstName={me?.firstName} lastName={me?.lastName} size={56} />
          <View style={styles.text}>
            <AppText variant="h3">{[me?.firstName, me?.lastName].filter(Boolean).join(' ')}</AppText>
            {me?.phone ? (
              <AppText variant="small" color="textMuted">
                {formatPhone(me.phone, 'international')}
              </AppText>
            ) : null}
          </View>
        </View>
      </Card>
      <AppText variant="bodyStrong" style={styles.section}>
        {t('auth.language')}
      </AppText>
      <LanguagePicker mode="full" />
      <View style={styles.logout}>
        <Button
          variant="outline"
          title={t('common:actions.logout')}
          loading={busy}
          onPress={async () => {
            setBusy(true);
            await runtime.auth.getState().logout();
            setBusy(false);
          }}
          testID="logout"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.xl },
  row: { flexDirection: 'row', alignItems: 'center' },
  text: { marginLeft: spacing.md, flex: 1 },
  section: { marginBottom: spacing.sm },
  logout: { marginTop: spacing.xxl },
});
