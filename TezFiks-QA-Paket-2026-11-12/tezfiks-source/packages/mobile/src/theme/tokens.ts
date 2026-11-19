/** Design tokens aligned with Figma v2: 00 · Cover & Brend / Brend rəngləri və tipoqrafiya. */
export const colors = {
  primary: '#2F5BFF',
  primaryDark: '#2147D8',
  primarySoft: '#EDF1FF',
  dark: '#0B1A5C',
  darkSoft: '#162B76',
  accent: '#F59E0B',
  accentSoft: '#FEF3C7',
  background: '#F5F7FC',
  surface: '#FFFFFF',
  danger: '#C83746',
  dangerSoft: '#FDECEC',
  text: '#0B1A5C',
  textMuted: '#5F6B7D',
  textInverse: '#FFFFFF',
  textInverseMuted: '#9AA8B6',
  border: '#DFE4EF',
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
  display: { fontFamily: fonts.bold, fontSize: 40, lineHeight: 48 },
  h1: { fontFamily: fonts.bold, fontSize: 26, lineHeight: 32 },
  h2: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 26 },
  h3: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22 },
  body: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  bodyStrong: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 20 },
  small: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  caption: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 14 },
  button: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20 },
} as const;

export type TypographyVariant = keyof typeof typography;

export const shadows = {
  card: {
    shadowColor: '#0B1A5C',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  sheet: {
    shadowColor: '#0B1A5C',
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: -4 },
    elevation: 12,
  },
} as const;

export const theme = { colors, fonts, spacing, radii, typography, shadows } as const;
export type Theme = typeof theme;
