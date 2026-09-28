import {
  BUILTIN_CODE_THEMES,
  DEFAULT_CODE_THEME_IDS,
  MAX_CUSTOM_THEMES,
  defaultCodeTheme,
  readCustomCodeTheme,
} from '../code-themes';
import type { CodeTheme, CodeThemeMode } from '../code-themes';

export const DEFAULT_CODE_FONT = 'SFMono-Regular';
export const DEFAULT_CODE_FONT_SIZE = 13;
export const MIN_CODE_FONT_SIZE = 10;
export const MAX_CODE_FONT_SIZE = 32;
export interface CodeAppearancePreferences {
  lightTheme: string;
  darkTheme: string;
  fontFamily: string;
  fontSize: number;
  customThemes: CodeTheme[];
}
export const DEFAULT_CODE_APPEARANCE: CodeAppearancePreferences = {
  lightTheme: DEFAULT_CODE_THEME_IDS.light,
  darkTheme: DEFAULT_CODE_THEME_IDS.dark,
  fontFamily: DEFAULT_CODE_FONT,
  fontSize: DEFAULT_CODE_FONT_SIZE,
  customThemes: [],
};

export const readCodeFontFamily = (value: unknown): string =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  value.length <= 100 &&
  !/[\x00-\x1f]/.test(value)
    ? value.trim()
    : DEFAULT_CODE_FONT;
export const readCodeFontSize = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.max(MIN_CODE_FONT_SIZE, Math.min(MAX_CODE_FONT_SIZE, Math.round(value)))
    : DEFAULT_CODE_FONT_SIZE;

export function resolveCodeTheme(
  preferences: CodeAppearancePreferences,
  mode: CodeThemeMode,
): CodeTheme {
  const id = preferences[mode === 'light' ? 'lightTheme' : 'darkTheme'];
  return (
    [...BUILTIN_CODE_THEMES, ...preferences.customThemes].find(
      (theme) => theme.id === id && theme.mode === mode,
    ) ?? defaultCodeTheme(mode)
  );
}

export function readCodeAppearance(value: unknown): {
  preferences: CodeAppearancePreferences;
  notice: string | null;
} {
  const saved =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  let damaged = value != null && (typeof value !== 'object' || Array.isArray(value));
  const customThemes: CodeTheme[] = [];
  if (saved.customThemes !== undefined && !Array.isArray(saved.customThemes)) damaged = true;
  for (const candidate of Array.isArray(saved.customThemes) ? saved.customThemes : []) {
    const theme = readCustomCodeTheme(candidate);
    if (
      !theme ||
      customThemes.length >= MAX_CUSTOM_THEMES ||
      customThemes.some((item) => item.id === theme.id)
    )
      damaged = true;
    else customThemes.push(theme);
  }
  const preferences = {
    lightTheme:
      typeof saved.lightTheme === 'string' ? saved.lightTheme : DEFAULT_CODE_THEME_IDS.light,
    darkTheme: typeof saved.darkTheme === 'string' ? saved.darkTheme : DEFAULT_CODE_THEME_IDS.dark,
    fontFamily: readCodeFontFamily(saved.fontFamily),
    fontSize: readCodeFontSize(saved.fontSize),
    customThemes,
  };
  for (const mode of ['light', 'dark'] as const) {
    const key = mode === 'light' ? 'lightTheme' : 'darkTheme';
    const valid = resolveCodeTheme(preferences, mode);
    if (
      (saved[key] !== undefined && typeof saved[key] !== 'string') ||
      preferences[key] !== valid.id
    )
      damaged = true;
    preferences[key] = valid.id;
  }
  return {
    preferences,
    notice: damaged
      ? '部分代码主题已损坏、缺失或不匹配，已回退到对应外观的内置主题。请在外观设置中重新选择或导入。'
      : null,
  };
}

export function codeAppearanceStyle(
  preferences: CodeAppearancePreferences,
  theme: CodeTheme,
): Record<string, string> {
  const family = readCodeFontFamily(preferences.fontFamily)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
  const style: Record<string, string> = {
    '--code-font-family': `"${family}", "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace`,
    '--code-font-size': `${readCodeFontSize(preferences.fontSize)}px`,
  };
  for (const [key, color] of Object.entries(theme.colors)) style[`--code-${key}`] = color;
  for (const [group, token] of Object.entries(theme.tokens)) {
    style[`--syntax-${group}`] = token.color;
    style[`--syntax-${group}-style`] = token.italic ? 'italic' : 'normal';
    style[`--syntax-${group}-weight`] = token.bold ? '700' : '400';
    style[`--syntax-${group}-decoration`] =
      [token.underline && 'underline', token.strikethrough && 'line-through']
        .filter(Boolean)
        .join(' ') || 'none';
  }
  return style;
}
