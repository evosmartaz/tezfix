/** Design tokens from design/01-brand-colors-typography.png (spec §13). */
export const colors = {
  primary: '#00A971',
  primaryDark: '#008A5C',
  primarySoft: '#E6F7F0',
  dark: '#0B1B2B',
  darkSoft: '#1A2B3C',
  accent: '#F59E0B',
  accentSoft: '#FEF3C7',
  background: '#F6F8FA',
  surface: '#FFFFFF',
  danger: '#E5484D',
  dangerSoft: '#FDECEC',
  text: '#0B1B2B',
  textMuted: '#5B6B7B',
  textInverse: '#FFFFFF',
  textInverseMuted: '#9AA8B6',
  border: '#E3E8EE',
  borderStrong: '#C9D2DC',
  disabled: '#C9D2DC',
  overlay: 'rgba(11, 27, 43, 0.55)',
  star: '#F59E0B',
  info: '#2F7DE1',
  infoSoft: '#E7F0FC',
} as const;

export type ColorName = keyof typeof colors;

/** Inter (Bold headings, SemiBold buttons, Regular text). Names match @expo-google-fonts/inter keys. */
export const fonts = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

export const spacing = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;

export const radii = { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 } as const;

export const typography = {
  display: { fontFamily: fonts.bold, fontSize: 34, lineHeight: 40 },
  h1: { fontFamily: fonts.bold, fontSize: 26, lineHeight: 32 },
  h2: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 26 },
  h3: { fontFamily: fonts.semibold, fontSize: 17, lineHeight: 22 },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21 },
  bodyStrong: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 21 },
  small: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  caption: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  button: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 20 },
} as const;

export type TypographyVariant = keyof typeof typography;

export const shadows = {
  card: {
    shadowColor: '#0B1B2B',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  sheet: {
    shadowColor: '#0B1B2B',
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: -4 },
    elevation: 12,
  },
} as const;

export const theme = { colors, fonts, spacing, radii, typography, shadows } as const;
export type Theme = typeof theme;
