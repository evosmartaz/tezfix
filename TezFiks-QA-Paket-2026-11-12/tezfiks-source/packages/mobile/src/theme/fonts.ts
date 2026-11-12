import {
  useFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';

/** The font map loaded at startup (keys match `fonts` in tokens). */
export const interFontMap = {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
};

/** Loads Inter. Returns true when ready (or when loading failed: the app falls back to the system font). */
export function useAppFonts(): boolean {
  const [loaded, error] = useFonts(interFontMap);
  return loaded || !!error;
}
