import { useEffect, useState } from 'react';

// Four steps of the same toolbar. Narrow widths shorten actions to icons and let the
// view tabs fall back to icons or scroll; nothing is ever hidden with display:none.
export type ToolbarTier = 'full' | 'compact' | 'condensed' | 'minimal';

export function toolbarTier(width: number): ToolbarTier {
  if (width >= 1100) return 'full';
  if (width >= 900) return 'compact';
  if (width >= 700) return 'condensed';
  return 'minimal';
}

export function useToolbarTier(): ToolbarTier {
  const [tier, setTier] = useState<ToolbarTier>(() =>
    toolbarTier(typeof window === 'undefined' ? 1440 : window.innerWidth),
  );
  useEffect(() => {
    const resize = () => setTier(toolbarTier(window.innerWidth));
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  return tier;
}
