import { useRef } from 'react';
import { usePullRequestCenter } from '../stores/pullRequestCenter';
import { useConnectionStore } from '../stores/connectionStore';
import { useRepositoryStore } from '../stores/repositoryStore';
import { uiAgent } from '../api/ui-agent';
import { useSocket } from './useSocket';
import { useAccessTokensStore } from '../stores/accessTokensStore';

// SSH activity is pushed by the server. Keep one subscription for the whole shell
// so every view reads the same connection status.
export function useConnectionStatusSync() {
  const applyConnectionStatus = useConnectionStore((state) => state.applyConnectionStatus);
  const fetchConnections = useConnectionStore((state) => state.fetchConnections);

  const previousAgent = useRef<typeof uiAgent>(undefined);

  useSocket({
    'repository:changed': (id?: string) => {
      if (id) window.aluneTray?.repositoryChanged(id);
      void useRepositoryStore.getState().fetchRepositories();
    },
    'connection:status': (event) => {
      if (event?.connectionId && event.status) applyConnectionStatus(event);
    },
    // Events emitted while the socket was down are lost, so resync on every connect.
    'access-tokens:changed': () => {
      void useAccessTokensStore.getState().load();
      usePullRequestCenter.getState().invalidate();
    },
    connect: (reason) => {
      if (uiAgent) {
        const store = useRepositoryStore.getState();
        // The active view owns initial status reads. Later connections resync missed changes.
        const resync =
          reason === 'resync' || (previousAgent.current && previousAgent.current !== uiAgent);
        previousAgent.current = uiAgent;
        void store.fetchRepositories().then(() => {
          if (resync) return store.refreshRepositoryStatuses();
        });
      }
      void fetchConnections();
      void useAccessTokensStore.getState().load();
    },
  });
}
