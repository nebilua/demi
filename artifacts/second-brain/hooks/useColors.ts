import { useColorScheme } from 'react-native';
import colors from '@/constants/colors';
import type { Appearance } from '@/context/AppContext';

/**
 * Returns the design tokens for the current color scheme.
 *
 * The returned object contains all color tokens for the active palette
 * plus scheme-independent values like `radius`.
 */
export function useColors(preference: Appearance = 'system') {
  const scheme = useColorScheme();
  const isDark =
    preference === 'dark' || (preference === 'system' && scheme === 'dark');
  const palette = isDark ? colors.dark : colors.light;
  return { ...palette, radius: colors.radius, isDark };
}
