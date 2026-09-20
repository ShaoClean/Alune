import { useConnectionStore } from '../stores/connectionStore';
import { useSocket } from './useSocket';

// SSH activity is pushed by the server. Keep one subscription for the whole shell
// so every view reads the same connection status.
export function useConnectionStatusSync() {
  const applyConnectionStatus = useConnectionStore((state) => state.applyConnectionStatus);
  const fetchConnections = useConnectionStore((state) => state.fetchConnections);

  useSocket({
    'connection:status': (event) => {
      if (event?.connectionId && event.status) applyConnectionStatus(event);
    },
    // Events emitted while the socket was down are lost, so resync on every connect.
    connect: () => void fetchConnections(),
  });
}

