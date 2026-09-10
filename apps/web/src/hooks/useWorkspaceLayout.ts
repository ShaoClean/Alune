import { useEffect, useState } from 'react';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { fitWorkspaceLayout } from '../stores/workspaceLayout';

export function useWorkspaceLayout() {
  const layout = useWorkspaceStore((state) => state.layout);
  const updateLayout = useWorkspaceStore((state) => state.updateLayout);
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const resize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  return { layout, updateLayout, ...fitWorkspaceLayout(layout, width) };
}
