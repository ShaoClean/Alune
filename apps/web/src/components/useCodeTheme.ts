import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import { useAppearance } from '../appearance';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { codeAppearanceStyle, resolveCodeTheme } from '../stores/codeAppearance';

export function useCodeTheme() {
  const mode = useAppearance((state) => state.theme);
  const preferences = useWorkspaceStore((state) => state.codeAppearance);
  const theme = resolveCodeTheme(preferences, mode);
  const style = useMemo(
    () => codeAppearanceStyle(preferences, theme) as CSSProperties,
    [preferences, theme],
  );
  return { theme, style };
}
