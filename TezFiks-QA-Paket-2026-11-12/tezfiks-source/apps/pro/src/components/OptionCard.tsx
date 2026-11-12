import React, { type ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppText, Card, colors, radii, spacing } from '@tezfiks/mobile';

export interface OptionCardProps {
  title: string;
  subtitle?: string;
  selected: boolean;
  onPress: () => void;
  icon?: ComponentProps<typeof Ionicons>['name'];
  testID?: string;
}

/** Radio option card (board 03 A "Fərdi usta" / "Usta şirkəti", board 04 "Usta özü daxil edir"). */
export function OptionCard({ title, subtitle, selected, onPress, icon, testID }: OptionCardProps) {
  return (
    <Card selected={selected} onPress={onPress} testID={testID} accessibilityLabel={title} style={styles.card}>
      <View style={styles.row}>
        {icon ? (
          <View style={[styles.iconBox, selected ? styles.iconBoxOn : null]}>
            <Ionicons name={icon} size={22} color={selected ? colors.primary : colors.textMuted} />
          </View>
        ) : null}
        <View style={styles.text}>
          <AppText variant="bodyStrong">{title}</AppText>
          {subtitle ? (
            <AppText variant="small" color="textMuted">
              {subtitle}
            </AppText>
          ) : null}
        </View>
        <View style={[styles.radio, selected ? styles.radioOn : null]} accessibilityRole="radio" accessibilityState={{ selected }}>
          {selected ? <View style={styles.dot} /> : null}
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center' },
  iconBox: { width: 44, height: 44, borderRadius: radii.md, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', marginRight: spacing.md },
  iconBoxOn: { backgroundColor: colors.primarySoft },
  text: { flex: 1, marginRight: spacing.sm },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: colors.primary },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
});
