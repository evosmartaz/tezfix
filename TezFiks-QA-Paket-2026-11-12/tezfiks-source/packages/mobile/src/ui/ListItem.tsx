import React, { type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '../theme/tokens';
import { AppText } from './Text';

export interface ListItemProps {
  title: string;
  subtitle?: string | null;
  left?: ReactNode;
  /** Right side: amount, badge, time... */
  right?: ReactNode;
  onPress?: () => void;
  chevron?: boolean;
  divider?: boolean;
  testID?: string;
}

/** Row used in history lists ("Sifariş #2847 — platforma haqqı  -10.00 ₼"), settings and menus. */
export function ListItem({ title, subtitle, left, right, onPress, chevron, divider = true, testID }: ListItemProps) {
  const body = (
    <View style={[styles.row, divider ? styles.divider : null]}>
      {left ? <View style={styles.left}>{left}</View> : null}
      <View style={styles.text}>
        <AppText variant="bodyStrong" numberOfLines={2}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="caption" color="textMuted" numberOfLines={2}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {right ? <View style={styles.right}>{right}</View> : null}
      {chevron ? <Ionicons name="chevron-forward" size={18} color={colors.textMuted} /> : null}
    </View>
  );
  if (!onPress) return <View testID={testID}>{body}</View>;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" testID={testID} style={({ pressed }) => (pressed ? styles.pressed : null)}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  left: { marginRight: spacing.md },
  text: { flex: 1 },
  right: { marginLeft: spacing.sm, alignItems: 'flex-end' },
  pressed: { opacity: 0.7 },
});
