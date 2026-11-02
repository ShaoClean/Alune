import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

// Route content can contribute navigation to the existing application title bar.
export const WorkspaceHeaderContext = createContext<HTMLDivElement | null>(null);

export function WorkspaceHeader({ children }: { children: ReactNode }) {
  const slot = useContext(WorkspaceHeaderContext);
  return slot ? createPortal(children, slot) : null;
}
