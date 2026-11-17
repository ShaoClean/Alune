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

  useSocket({
    'repository:changed': () => {
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
    connect: () => {
      if (uiAgent) {
        const store = useRepositoryStore.getState();
        void store.fetchRepositories().then(() => store.refreshRepositoryStatuses());
      }
      void fetchConnections();
      void useAccessTokensStore.getState().load();
    },
  });
}
