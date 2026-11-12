import React from 'react';
import { StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '@tezfiks/mobile';
import { categoryIcon } from '../lib/categories';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

/** MaterialCommunityIcons glyph for `category.icon` with a fallback for unknown names, on a soft green disc. */
export function CategoryIcon({ icon, size = 22, boxed = true, testID }: { icon: string | null | undefined; size?: number; boxed?: boolean; testID?: string }) {
  const glyphs = (MaterialCommunityIcons as unknown as { glyphMap?: Record<string, unknown> }).glyphMap;
  const name = categoryIcon(icon, glyphs) as IconName;
  const glyph = <MaterialCommunityIcons name={name} size={size} color={colors.primaryDark} testID={testID} />;
  if (!boxed) return glyph;
  return <View style={[styles.box, { width: size * 1.9, height: size * 1.9, borderRadius: size }]}>{glyph}</View>;
}

const styles = StyleSheet.create({
  box: { backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
});
