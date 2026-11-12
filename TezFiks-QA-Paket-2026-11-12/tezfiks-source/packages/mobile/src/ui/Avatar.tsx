import React, { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { initialsOf } from '../format';
import { colors } from '../theme/tokens';
import { AppText } from './Text';

export interface AvatarProps {
  uri?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  size?: number;
  testID?: string;
}

/** Round photo; falls back to initials (Azerbaijani-aware: "ilkin" → "İ") when there is no photo or it fails to load. */
export function Avatar({ uri, firstName, lastName, size = 44, testID = 'avatar' }: AvatarProps) {
  const [failed, setFailed] = useState(false);
  const dim = { width: size, height: size, borderRadius: size / 2 };
  if (uri && !failed) {
    return <Image source={{ uri }} style={[styles.img, dim]} onError={() => setFailed(true)} testID={`${testID}-image`} />;
  }
  return (
    <View style={[styles.fallback, dim]} testID={`${testID}-initials`}>
      <AppText style={{ fontFamily: 'Inter_600SemiBold', fontSize: size * 0.38, color: colors.primaryDark }}>
        {initialsOf(firstName, lastName)}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  img: { backgroundColor: colors.border },
  fallback: { backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
});
