/**
 * Design tokens from the "TezFiks — App UI (editable)" brand board (v2, 2026-11): royal-blue primary, navy dark,
 * amber fee accent, lime on dark, one light theme for every screen (UX-C19).
 */
export const colors = {
  primary: '#2F5BFF',
  /** Pressed state of primary surfaces. */
  primaryDark: '#2246D8',
  primarySoft: '#EDF1FF',
  /** Halo around the current step / location pulse. */
  primaryHalo: '#C9D5FF',
  dark: '#0B1A5C',
  darkSoft: '#1B2B70',
  accent: '#F59E0B',
  accentSoft: '#FEF4E2',
  /** Text on accentSoft (fee and warning notices). */
  accentText: '#B45309',
  /** Lime headings on navy cards ("TezFiks Zəmanəti", "Korporativ ödəniş"). */
  mint: '#D4F53C',
  background: '#F5F7FC',
  surface: '#FFFFFF',
  /** Filled inputs, stat tiles and segmented tracks. */
  surfaceMuted: '#EEF1F8',
  danger: '#C83746',
  dangerSoft: '#FBE9EB',
  text: '#0F1729',
  textMuted: '#5F6B7D',
  textInverse: '#FFFFFF',
  textInverseMuted: '#AEB8DC',
  border: '#DFE4EF',
  borderStrong: '#C5CDDF',
  /** Disabled button fill; its label uses textMuted (contrast >= 3:1, UX-C15). */
  disabled: '#DFE4EF',
  overlay: 'rgba(11, 26, 92, 0.55)',
  star: '#F59E0B',
  info: '#2F5BFF',
  infoSoft: '#EDF1FF',
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

/** Type scale of the brand board (size/line height). */
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
  numeric: { fontFamily: fonts.bold, fontSize: 32, lineHeight: 38 },
} as const;

export type TypographyVariant = keyof typeof typography;

export const shadows = {
  card: {
    shadowColor: '#0B1A5C',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  sheet: {
    shadowColor: '#0B1A5C',
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: -4 },
    elevation: 12,
  },
} as const;

export const theme = { colors, fonts, spacing, radii, typography, shadows } as const;
export type Theme = typeof theme;
