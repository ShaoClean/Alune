export type ThemePreference = 'system' | 'light' | 'dark';
export interface AppearancePreferences {
  theme: ThemePreference;
  reduceMotion: boolean;
}
export const DEFAULT_APPEARANCE: AppearancePreferences = { theme: 'system', reduceMotion: false };

export function readAppearancePreferences(value: unknown): AppearancePreferences {
  const saved = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    theme: saved.theme === 'light' || saved.theme === 'dark' ? saved.theme : 'system',
    reduceMotion: saved.reduceMotion === true,
  };
}

export function resolveAppearance(
  preferences: AppearancePreferences,
  dark: boolean,
  reduced: boolean,
) {
  return {
    theme: preferences.theme === 'system' ? (dark ? 'dark' : 'light') : preferences.theme,
    reduceMotion: preferences.reduceMotion || reduced,
  };
}
