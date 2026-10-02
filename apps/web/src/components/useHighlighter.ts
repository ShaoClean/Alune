import { useEffect, useState } from 'react';

// Prism turns every token into an element; beyond this keep readable plain text.
export const HIGHLIGHT_MAX_CHARS = 256 * 1024;
let highlighterModule: Promise<typeof import('./syntax-highlight')> | undefined;
const loadHighlighter = () =>
  (highlighterModule ??= import('./syntax-highlight').catch((error) => {
    highlighterModule = undefined;
    throw error;
  }));

export function useHighlighter(enabled: boolean, path: string) {
  const [module, setModule] = useState<Awaited<ReturnType<typeof loadHighlighter>> | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!enabled || module) return;
    let active = true;
    loadHighlighter().then(
      (loaded) => {
        if (active) {
          setModule(loaded);
          setFailed(false);
        }
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [enabled, module, path]);
  return { module, failed };
}
