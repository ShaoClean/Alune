import { createContext, useContext } from 'react';
import { useLocation } from 'react-router-dom';
import type { Location } from 'react-router-dom';

/** Every open tab stays mounted, so its list needs an id of its own. */
export const workspaceListId = (repoId: string) => `workspace-list-${repoId}`;

export interface RepositoryWorkspaceValue {
  repoId: string;
  /** False while another tab, page or settings is in front of this one. */
  active: boolean;
  /** The address this tab last had while it was in front. */
  location: Location;
}

export const RepositoryWorkspaceContext = createContext<RepositoryWorkspaceValue | null>(null);

export const useRepositoryWorkspace = () => useContext(RepositoryWorkspaceContext);

/**
 * The router location inside a repository tab. A hidden tab keeps reading the address
 * it was shown at, so another tab's query or navigation cannot act on it.
 */
export function useWorkspaceLocation(): Location {
  const location = useLocation();
  return useContext(RepositoryWorkspaceContext)?.location ?? location;
}
