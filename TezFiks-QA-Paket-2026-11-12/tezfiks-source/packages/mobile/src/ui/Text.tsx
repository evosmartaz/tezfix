import React from 'react';
import { Text, type TextProps, type TextStyle } from 'react-native';
import { colors, typography, type ColorName, type TypographyVariant } from '../theme/tokens';

export interface AppTextProps extends TextProps {
  variant?: TypographyVariant;
  color?: ColorName;
  align?: TextStyle['textAlign'];
}

/** Text with the Inter scale from board 01. Never use textTransform uppercase for Azerbaijani (use upperAzSafe). */
export function AppText({ variant = 'body', color = 'text', align, style, ...rest }: AppTextProps) {
  return <Text {...rest} style={[typography[variant], { color: colors[color] }, align ? { textAlign: align } : null, style]} />;
}
