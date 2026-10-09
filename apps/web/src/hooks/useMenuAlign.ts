import { useCallback, useState } from 'react';
import { useRepositoryWorkspace, workspaceListId } from './useRepositoryWorkspace';

const GAP = 8;

// Toolbar menus open straight below their trigger. When the right panel (the changes
// list) is visible, the popup's right edge is pulled back to that panel's left edge so an
// open menu never covers the list the user is reading.
export function useMenuAlign() {
  const [offsetX, setOffsetX] = useState(0);
  const repoId = useRepositoryWorkspace()?.repoId;

  const measure = useCallback(
    (trigger: HTMLElement | null) => {
      const panel = repoId && document.getElementById(workspaceListId(repoId));
      if (!trigger || !panel) return setOffsetX(0);
      const triggerRight = trigger.getBoundingClientRect().right;
      const panelLeft = panel.getBoundingClientRect().left;
      setOffsetX(Math.min(0, Math.round(panelLeft - GAP - triggerRight)));
    },
    [repoId],
  );

  return {
    measure,
    align: { points: ['tr', 'br'], offset: [offsetX, 4] },
  };
}
