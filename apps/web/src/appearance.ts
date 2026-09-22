import { create } from 'zustand';
import { useWorkspaceStore } from './stores/workspaceStore';
import { resolveAppearance } from './stores/appearance';

export const useAppearance = create(() => ({
  theme: 'light' as 'light' | 'dark',
  reduceMotion: false,
}));

// Run after workspace hydration and before React mounts. One owner for OS listeners.
export function initializeAppearance() {
  const dark = window.matchMedia('(prefers-color-scheme: dark)');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const apply = () => {
    const resolved = resolveAppearance(
      useWorkspaceStore.getState().appearance,
      dark.matches,
      reduced.matches,
    );
    document.documentElement.dataset.theme = resolved.theme;
    document.documentElement.dataset.reducedMotion = String(resolved.reduceMotion);
    useAppearance.setState(resolved);
  };
  apply();
  const unsubscribe = useWorkspaceStore.subscribe((state, previous) => {
    if (state.appearance !== previous.appearance) apply();
  });
  dark.addEventListener('change', apply);
  reduced.addEventListener('change', apply);
  return () => {
    unsubscribe();
    dark.removeEventListener('change', apply);
    reduced.removeEventListener('change', apply);
  };
}
